var message = require('./message');
var error = require('./error');
var binding = require('./binding');
var util = require('./util');

var EntityTransaction = require('./EntityTransaction');
var Query = require('./Query');
var Metadata = require('./util/Metadata');
var Message = require('./connector/Message');
var StatusCode = Message.StatusCode;

/**
 * @class baqend.EntityManager
 * @extends baqend.util.Lockable
 *
 * @param {baqend.EntityManagerFactory} entityManagerFactory The factory which of this entityManager instance
 * @param {Boolean=} global <code>true</code> to use the global authorization mechanism via cookies,
 *                          <code>false</code> to use token base authorization
 */
var EntityManager = Object.inherit(util.Lockable, /** @lends baqend.EntityManager.prototype */ {

  /**
   * Creates a new List collection
   * @function
   * @param {baqend.collection.Collection|Array=} collection The initial array or collection to initialize the new List
   * @return {baqend.collection.List} The new created List
   */
  List: require('./collection').List,

  /**
   * Creates a new Set collection
   * @function
   * @param {baqend.collection.Collection|Array=} collection The initial array or collection to initialize the new Set
   * @return {baqend.collection.Set} The new created Set
   */
  Set: require('./collection').Set,

  /**
   * Creates a new Map collection
   * @function
   * @param {baqend.collection.Collection|Array=} collection The initial array or collection to initialize the new Map
   * @return {baqend.collection.Map} The new created Map
   */
  Map: require('./collection').Map,

  /**
   * Creates a new GeoPoint
   * @function
   * @param {String|Number|Object|Array=} latitude A coordinate pair (latitude first), a GeoPoint like object or the GeoPoint's latitude
   * @param {Number=} longitude The GeoPoint's longitude
   * @return {baqend.collection.GeoPoint} The new created Map
   */
  GeoPoint: require('./GeoPoint'),

  /**
   * @type baqend.EntityManagerFactory
   */
  entityManagerFactory: null,

  /**
   * @type baqend.metamodel.Metamodel
   */
  metamodel: null,

  /**
   * @type baqend.util.Code
   */
  code: null,

  /**
   * @type baqend.util.Modules
   */
  modules: null,

  /**
   * The connector used for baqend requests
   * @type baqend.connector.Connector
   * @private
   */
  _connector: null,

  /**
   * All managed and cached entity instances
   * @type object<String,baqend.binding.Entity>
   * @private
   */
  _entities: null,

  /**
   * Determine whether the entity manager is open.
   * true until the entity manager has been closed
   * @type Boolean
   */
  get isOpen() {
    return !!this._connector;
  },

  /**
   * The authentication token if the user is logged in currently
   * @type String
   */
  token: null,

  /**
   * The current logged in user object
   * @type baqend.binding.User
   */
  me: null,

  /**
   * Returns true if the device token is already registered, otherwise false.
   * @type boolean
   */
  isDeviceRegistered: false,

  /**
   * Returns true if this EntityManager is the global one, otherwise false.
   * @returns {boolean} isGlobal
   */
  isGlobal: false,

  constructor: function EntityManager(entityManagerFactory, global) {
    this.entityManagerFactory = entityManagerFactory;
    this.metamodel = entityManagerFactory.metamodel;
    this.code = entityManagerFactory.code;
    this.isGlobal = !!global;
  },

  /**
   * Connects this entityManager, used for synchronous and asynchronous initialization
   * @param {baqend.connector.Connector} connector
   */
  connected: function(connector) {
    this._connector = connector;
    this._entities = {};

    this._createObjectFactory(this.metamodel.embeddables);
    this._createObjectFactory(this.metamodel.entities);

    this.transaction = new EntityTransaction(this);
    this.modules = new util.Modules(this, connector);

    if (this.isGlobal) {
      var msg = new message.Me();
      msg.withAuthorizationToken();
      return Promise.all([this.checkDeviceRegistration(), this._userRequest(msg, true)]);
    }
  },

  /**
   * @param {baqend.metamodel.ManagedType[]} types
   * @return {baqend.binding.ManagedFactory}
   * @private
   */
  _createObjectFactory: function(types) {
    Object.keys(types).forEach(function(ref) {
      var type = this.metamodel.managedType(ref);
      var name = type.name;

      if (this[name]) {
        type.typeConstructor = this[name];
        Object.defineProperty(this, name, {
          value: type.createObjectFactory(this)
        });
      } else {
        Object.defineProperty(this, name, {
          get: function() {
            Object.defineProperty(this, name, {
              value: type.createObjectFactory(this)
            });

            return this[name];
          },
          set: function(typeConstructor) {
            type.typeConstructor = typeConstructor;
          },
          configurable: true
        });
      }
    }, this);
  },

  _sendOverSocket : function(message) {
    message.token = this.token;
    this._connector.sendOverSocket(message);
  },

  _subscribe : function(topic, cb) {
    this._connector.subscribe(topic, cb);
  },

  _unsubscribe : function(topic, cb) {
    this._connector.unsubscribe(topic, cb);
  },

  _send: function(message) {
    message.withAuthorizationToken(this.isGlobal? null: this.token);
    return this._connector.send(message).then(function() {
      var token = message.getAuthorizationToken();
      if (token)
        this.token = token;

      return message;
    }.bind(this));
  },

  /**
   * Get an instance, whose state may be lazily fetched. If the requested instance does not exist
   * in the database, the EntityNotFoundError is thrown when the instance state is first accessed.
   * The application should not expect that the instance state will be available upon detachment,
   * unless it was accessed by the application while the entity manager was open.
   *
   * @param {(Function|String)} entityClass
   * @param {String=} key
   */
  getReference: function(entityClass, key) {
    var id, type;
    if (key) {
      type = this.metamodel.entity(entityClass);
      if (key.indexOf('/db/') == 0) {
        id = key;
      } else {
        id = type.ref + '/' + encodeURIComponent(key);
      }
    } else {
      id = entityClass;
      type = this.metamodel.entity(id.substring(0, id.indexOf('/', 4))); //skip /db/
    }

    var entity = this._entities[id];
    if (!entity) {
      entity = type.create();
      var metadata = Metadata.get(entity);
      metadata.id = id;
      metadata.setUnavailable();

      this._attach(entity);
    }

    return entity;
  },

  /**
   * Creates an instance of Query.Builder for query creation and execution. The Query results are instances of the
   * resultClass argument.
   * @param {Function=} resultClass - the type of the query result
   * @return {baqend.Query.Builder} A query builder to create one ore more queries for the specified class
   */
  createQueryBuilder: function(resultClass) {
    return new Query.Builder(this, resultClass);
  },

  /**
   * Clear the persistence context, causing all managed entities to become detached.
   * Changes made to entities that have not been flushed to the database will not be persisted.
   */
  clear: function() {
    this._entities = {};
  },

  /**
   * Close an application-managed entity manager. After the close method has been invoked,
   * all methods on the EntityManager instance and any Query and TypedQuery objects obtained from it
   * will throw the IllegalStateError except for transaction, and isOpen (which will return false).
   * If this method is called when the entity manager is associated with an active transaction,
   * the persistence context remains managed until the transaction completes.
   */
  close: function() {
    this._connector = null;

    return this.clear();
  },

  /**
   * Check if the instance is a managed entity instance belonging to the current persistence context.
   * @param {baqend.binding.Entity} entity - entity instance
   * @returns {Boolean} boolean indicating if entity is in persistence context
   */
  contains: function(entity) {
    return !!entity && this._entities[entity.id] === entity;
  },

  /**
   * Check if an object with the id from the given entity is already attached.
   * @param {baqend.binding.Entity} entity - entity instance
   * @returns {Boolean} boolean indicating if entity with same id is attached
   */
  containsById: function(entity) {
    return !!(entity && this._entities[entity.id]);
  },

  /**
   * Remove the given entity from the persistence context, causing a managed entity to become detached.
   * Unflushed changes made to the entity if any (including removal of the entity),
   * will not be synchronized to the database. Entities which previously referenced the detached entity will continue to reference it.
   * @param {baqend.binding.Entity} entity - entity instance
   */
  detach: function(entity) {
    var state = Metadata.get(entity);
    return state.withLock(function() {
      this.removeReference(entity);
      return Promise.resolve(entity);
    }.bind(this));
  },

  /**
   * Resolve the depth by loading the referenced objects of the given entity.
   *
   * @param {baqend.binding.Entity} entity - entity instance
   * @param {Object} [options] The load options
   * @return {Promise<baqend.binding.Entity>}
   */
  resolveDepth: function(entity, options) {
    if(!options || !options.depth)
      return Promise.resolve(entity);

    options.resolved = options.resolved || [];
    var promises = [];
    var subOptions = Object.extend({}, options);
    subOptions.depth = options.depth === true ? true : options.depth-1;
    this.getSubEntities(entity, 1).forEach(function(subEntity) {
      if(subEntity != null && !~options.resolved.indexOf(subEntity)) {
        options.resolved.push(subEntity);
        promises.push(this.load(subEntity.id, null, subOptions));
      }
    }.bind(this));

    return Promise.all(promises).then(function() {
      return entity;
    });
  },

  /**
   * Loads Object ID. Search for an entity of the specified oid.
   * If the entity instance is contained in the persistence context, it is returned from there.
   * @param {(Function|String)} entityClass - entity class
   * @param {String} oid - Object ID
   * @param {Object} [options] The load options
   * @return {Promise<baqend.binding.Entity>}
   */
  load: function(entityClass, oid, options) {
    options = options || {};
    var entity = this.getReference(entityClass, oid);
    var state = Metadata.get(entity);

    var tid = 0;

    //TODO: implement transactional changed case
    //if (this.transaction.isChanged(ref))
    //  tid = this.transaction.tid;

    var msg = new message.GetObject(state.bucket, state.key);

    //msg.setCacheControl('max-age=0,no-cache');

    if (state.version || options.refresh) {
      // force a refresh with a unused eTag
      msg.setIfNoneMatch(options.refresh? '': state.version);
    }

    return this._send(msg).then(function(msg) {
      if (msg.response.status != StatusCode.NOT_MODIFIED) {
        state.setJson(msg.response.entity);
      }

      state.setPersistent();

      return this.resolveDepth(entity, options);
    }.bind(this), function(e) {
      if (e.status == StatusCode.OBJECT_NOT_FOUND) {
        this.removeReference(entity);
        state.setRemoved();
        return null;
      } else {
        throw e;
      }
    }.bind(this));
  },

  /**
   * @param {baqend.binding.Entity} entity
   * @param {Object} options
   * @return {Promise<baqend.binding.Entity>}
   */
  insert: function(entity, options) {
    options = options || {};
    var isNew;

    return this._save(entity, options, function(state) {
      if (state.version)
        throw new error.PersistentError('Existing objects can\'t be inserted.');

      isNew = !state.id;

      return new message.CreateObject(state.bucket, state.getJson());
    }).then(function(val) {
      if (isNew)
        this._attach(entity);

      return val;
    }.bind(this));
  },

  /**
   * @param {baqend.binding.Entity} entity
   * @param {Object} options
   * @return {Promise<baqend.binding.Entity>}
   */
  update: function(entity, options) {
    options = options || {};

    return this._save(entity, options, function(state) {
      if(!state.version)
        throw new error.PersistentError("New objects can't be inserted.");

      if (options.force) {
        var msg = new message.ReplaceObject(state.bucket, state.key, state.getJson(true));
        msg.setIfMatch('*');
        return msg;
      } else {
        msg = new message.ReplaceObject(state.bucket, state.key, state.getJson(false));
        msg.setIfMatch(state.version);
        return msg;
      }
    });
  },

  /**
   * @param {baqend.binding.Entity} entity
   * @param {Object} options The save options
   * @return {Promise<baqend.binding.Entity>}
   */
  save: function(entity, options) {
    options = options || {};

    return this._save(entity, options, function(state) {
      if (options.force) {
        if (!state.id)
          throw new error.PersistentError("New special objects can't be forcedly saved.");

        return new message.ReplaceObject(state.bucket, state.key, state.getJson(true));
      } else if (state.version) {
        var msg = new message.ReplaceObject(state.bucket, state.key, state.getJson(false));
        msg.setIfMatch(state.version);
        return msg;
      } else {
        return new message.CreateObject(state.bucket, state.getJson());
      }
    });
  },

  /**
   * @param {baqend.binding.Entity} entity
   * @param {Function} cb pre-safe callback
   * @return {Promise<baqend.binding.Entity>}
   */
  optimisticSave: function(entity, cb) {
    var abort = false;
    var abortFn = function() {
      abort = true;
    };
    var promise = Promise.resolve(cb(entity, abortFn));

    if(abort)
      return Promise.resolve(entity);

    return promise.then(function() {
      return entity.save().catch(function(e) {
        if(e.status == 412) {
          return this.refresh(entity).then(function() {
            return this.optimisticSave(entity, cb);
          }.bind(this));
        } else {
          throw e;
        }
      }.bind(this));
    }.bind(this));
  },

  /**
   * Save the object state
   * @param {baqend.binding.Entity} entity
   * @param {Object} options
   * @param {Function} msgFactory
   * @return {Promise.<baqend.binding.Entity>}
   * @private
   */
  _save: function(entity, options, msgFactory) {
    this.attach(entity);
    var state = Metadata.get(entity);
    return state.withLock(function() {
      var refPromises;
      if (state.isDirty) {
        if(!options.refresh) {
          state.setPersistent();
        }

        var sendPromise = this._send(msgFactory(state)).then(function(msg) {
          if(options.refresh) {
            state.setJson(msg.response.entity);
            state.setPersistent();
          } else {
            state.setJsonMetadata(msg.response.entity);
          }
          return entity;
        }.bind(this), function(e) {
          if (e.status == StatusCode.OBJECT_NOT_FOUND) {
            this.removeReference(entity);
            state.setRemoved();
            return null;
          } else {
            state.setDirty();
            throw e;
          }
        }.bind(this));

        refPromises = [sendPromise];
      } else {
        refPromises = [Promise.resolve(entity)];
      }

      var subOptions = Object.extend({}, options);
      subOptions.depth = 0;
      this.getSubEntities(entity, options.depth).forEach(function(sub) {
        refPromises.push(this._save(sub, subOptions, msgFactory));
      }.bind(this));

      return Promise.all(refPromises).then(function() {
        return entity
      });
    }.bind(this));
  },

  /**
   * Returns all referenced sub entities for the given depth and root entity
   * @param {baqend.binding.Entity} entity
   * @param {Boolean|Number} depth
   * @param {baqend.binding.Entity[]} [resolved]
   * @param {baqend.binding.Entity=} initialEntity
   * @returns {baqend.binding.Entity[]}
   */
  getSubEntities: function(entity, depth, resolved, initialEntity) {
    resolved = resolved || [];
    if(!depth) {
      return resolved;
    }
    initialEntity = initialEntity || entity;

    var state = Metadata.get(entity);
    for (var iter = state.type.references(), item = iter.next(); !item.done; item = iter.next()) {
      this.getSubEntitiesByPath(entity, item.value.path).forEach(function(subEntity) {
        if(!~resolved.indexOf(subEntity) && subEntity != initialEntity) {
          resolved.push(subEntity);
          resolved = this.getSubEntities(subEntity, depth === true ? depth : depth-1, resolved, initialEntity);
        }
      }.bind(this));
    }

    return resolved;
  },

  /**
   * Returns all referenced one level sub entities for the given path
   * @param {baqend.binding.Entity} entity
   * @param {Array} path
   * @returns {baqend.binding.Entity[]}
   */
  getSubEntitiesByPath: function(entity, path) {
    var subEntities = [entity];

    path.forEach(function(attributeName) {

      var tmpSubEntities = [];
      subEntities.forEach(function(subEntity) {
        var curEntity = subEntity[attributeName];
        if(!curEntity)
          return;

        var attribute = this.metamodel.managedType(subEntity.constructor).getAttribute(attributeName);
        if(attribute.isCollection) {
          for (var colIter = curEntity.entries(), colItem; !(colItem = colIter.next()).done; ) {
            tmpSubEntities.push(colItem.value[1]);
            attribute.keyType && attribute.keyType.isEntity && tmpSubEntities.push(colItem.value[0]);
          }
        } else {
          tmpSubEntities.push(curEntity);
        }
      }.bind(this));
      subEntities = tmpSubEntities;

    }.bind(this));

    return subEntities;
  },

  /**
   * Delete the entity instance.
   * @param {baqend.binding.Entity} entity
   * @param {Object} options The delete options
   * @return {Promise<baqend.binding.Entity>}
   */
  delete: function(entity, options) {
    options = options || {};

    this.attach(entity);
    var state = Metadata.get(entity);

    return state.withLock(function() {
      if(!state.version && !options.force)
        throw new error.IllegalEntityError(entity);

      var msg = new message.DeleteObject(state.bucket, state.key);

      if (!options.force)
        msg.setIfMatch(state.version);

      var refPromises = [ this._send(msg).then(function() {
        this.removeReference(entity);
        state.setRemoved();
        return entity;
      }.bind(this)) ];

      var subOptions = Object.extend({}, options);
      subOptions.depth = 0;
      this.getSubEntities(entity, options.depth).forEach(function(sub) {
        refPromises.push(this.delete(sub, subOptions));
      }.bind(this));

      return Promise.all(refPromises).then(function() {
        return entity;
      });
    }.bind(this));
  },

  /**
   * Synchronize the persistence context to the underlying database.
   *
   * @returns {baqend.Promise}
   */
  flush: function(doneCallback, failCallback) {
    // TODO: implement this
  },

  /**
   * Make an instance managed and persistent.
   * @param {baqend.binding.Entity} entity - entity instance
   */
  persist: function(entity) {
    entity.attach(this);
  },

  /**
   * Refresh the state of the instance from the database, overwriting changes made to the entity, if any.
   * @param {baqend.binding.Entity} entity - entity instance
   * @param {Object} options The refresh options
   * @return {Promise<baqend.binding.Entity>}
   */
  refresh: function(entity, options) {
    options = options || {};
    options.refresh = true;

    return this.load(entity.id, null, options);
  },

  /**
   * Attach the instance to this database context, if it is not already attached
   * @param {baqend.binding.Entity} entity The entity to attach
   */
  attach: function(entity) {
    if (!this.contains(entity)) {
      var type = this.metamodel.entity(classOf(entity));
      if (!type)
        throw new error.IllegalEntityError(entity);

      if(this.containsById(entity))
        throw new error.EntityExistsError(entity);

      this._attach(entity);
    }
  },

  _attach: function(entity) {
    var metadata = Metadata.get(entity);
    if (metadata.isAttached) {
      if (metadata.db != this) {
        throw new error.EntityExistsError(entity);
      }
    } else {
      metadata.db = this;
    }

    if (!metadata.id) {
      if (metadata.type.name != 'User' && metadata.type.name != 'Role') {
        metadata.id = '/db/' + metadata.type.name + '/' + util.uuid();
      }
    }

    if (metadata.id) {
      this._entities[metadata.id] = entity;
    }
  },

  removeReference: function(entity) {
    var state = Metadata.get(entity);
    if (!state)
      throw new error.IllegalEntityError(entity);

    delete this._entities[state.id];
  },

  register: function(user, password, login) {
    if (this.me && login)
      throw new error.PersistentError('User is already logged in.');

    return this.withLock(function() {
      var msg = new message.Register({
        user: user,
        password: password,
        global: this.isGlobal,
        login: login
      });

      return this._userRequest(msg, login);
    }.bind(this));
  },

  login: function(username, password) {
    if (this.me)
      throw new error.PersistentError('User is already logged in.');

    return this.withLock(function() {
      var msg = new message.Login({
        username: username,
        password: password,
        global: this.isGlobal
      });

      return this._userRequest(msg, true);
    }.bind(this));
  },

  logout: function() {
    return this.withLock(function() {
      var logout = function() {
        this.me = null;
        this.token = null;
      }.bind(this);
      return this.isGlobal ? this._send(new message.Logout()).then(logout) : Promise.resolve(logout());
    }.bind(this));
  },

  loginWithOAuth: function(provider, clientID, options) {
    options = Object.extend({
      title: "Login with " + provider,
      timeout: 5 * 60 * 1000,
      state: {}
    }, options);

    var state = Object.extend(options.state, {
      isGlobal: this.isGlobal
    });

    var msg;
    if (Message[provider + 'OAuth']) {
      msg = new Message[provider + 'OAuth'](clientID, options.scope, JSON.stringify(state));
    } else {
      throw new Error("Provider not supported.")
    }

    var req = this._userRequest(msg, true);
    var w = open(msg.request.path, options.title, 'width=' + options.width + ',height=' + options.height);

    return new Promise(function(resolve, reject) {
      var timeout = setTimeout(function() {
        reject(new error.PersistentError('OAuth login timeout.'));
      }, options.timeout);

      req.then(function(result) {
        clearTimeout(timeout);
        resolve(result);
      }, function(e) {
        clearTimeout(timeout);
        reject(e);
      });
    }.bind(this));
  },

  renew: function() {
    return this.withLock(function() {
      var msg = new message.Me();
      msg.withAuthorizationToken(this.isGlobal? false: this.token);
      return this._userRequest(msg, true);
    }.bind(this));
  },

  newPassword: function(username, password, newPassword) {
    return this.withLock(function() {
      var msg = new message.NewPassword({
        username: username,
        password: password,
        newPassword: newPassword,
        global: this.isGlobal
      });

      return this._send(msg).then(function() {
        var user = this.getReference(msg.response.entity.id);
        var metadata = Metadata.get(user);
        metadata.setJson(msg.response.entity);
        metadata.setPersistent();
      }.bind(this));
    }.bind(this));
  },

  _userRequest: function(msg, updateMe) {
    return this._send(msg).then(function() {
      var user = this.getReference(msg.response.entity.id);
      var metadata = Metadata.get(user);
      metadata.setJson(msg.response.entity);
      metadata.setPersistent();
      if (updateMe)
        this.me = user;

      return user;
    }.bind(this), function(e) {
      if (e.status == StatusCode.OBJECT_NOT_FOUND) {
        return null;
      } else {
        throw e;
      }
    });
  },

  registerDevice: function(os, token, device) {
    var msg = new message.DeviceRegister({
      token: token,
      devicetype: os,
      device: device
    });

    return this._send(msg);
  },

  checkDeviceRegistration: function() {
    return this._send(new message.DeviceRegistered()).then(function() {
      return this.isDeviceRegistered = true;
    }.bind(this), function(e) {
      if (e.status == StatusCode.OBJECT_NOT_FOUND) {
        return this.isDeviceRegistered = false;
      } else {
        throw e;
      }
    }.bind(this));
  },

  pushDevice: function(pushMessage) {
    return this._send(new message.DevicePush(pushMessage));
  },

  /**
   * The given entity will be checked by the validation code of the entity type.
   *
   * @param {baqend.binding.Entity} entity
   * @returns {baqend.util.ValidationResult} result
   */
  validate: function(entity) {
    var type = Metadata.get(entity).type;

    var result = new util.ValidationResult();
    for (var iter = type.attributes(), item; !(item = iter.next()).done; ) {
      var validate = new util.Validator(item.value.name, entity);
      result.fields[validate.key] = validate;
    }

    var validationCode = type.validationCode;
    if(validationCode) {
      validationCode(result.fields);
    }

    return result;
  },

  /**
   * An User factory for user objects.
   * The User factory can be called to create new instances of users or can be used to register/login/logout users.
   * The created instances implements the {@link baqend.binding.User} interface
   * @type baqend.binding.UserFactory
   */
  User: null,

  /**
   * An Device factory for user objects.
   * The Device factory can be called to create new instances of devices or can be used to register, push to and
   * check registration status of devices.
   * @type baqend.binding.DeviceFactory
   */
  Device: null

  /**
   * An Object factory for embeddable objects,
   * that can be accessed by the type name of the embeddable type.
   * An object factory can be called to create new instances of the type.
   * The created instances implements the {@link baqend.binding.Managed} interface
   * @name &lt;<i>YourEmbeddableClass</i>&gt;
   * @memberOf baqend.EntityManager.prototype
   * @type {baqend.binding.ManagedFactory}
   */

  /**
   * An Object factory for entity objects,
   * that can be accessed by the type name of the entity type.
   * An object factory can be called to create new instances of the type.
   * The created instances implements the {@link baqend.binding.Entity} interface
   * @name &lt;<i>YourEntityClass</i>&gt;
   * @memberOf baqend.EntityManager.prototype
   * @type {baqend.binding.EntityFactory}
   */

  /**
   * An Role factory for role objects.
   * The Role factory can be called to create new instances of roles.
   * The created instances implements the {@link baqend.binding.Role} interface
   * @name Role
   * @memberOf baqend.EntityManager.prototype
   * @type baqend.binding.EntityFactory
   */
});

module.exports = EntityManager;