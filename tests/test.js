var context;
if (!jspa) {
	var jspa = require('../build/jspa.js');
	context = global;
} else {
	context = window;
}

context.PersClass = Object.inherit({
	initialize : function(ref, name, persRef) {
		this.ref = ref;
		this.name = name;
		this.persRef = persRef;
	}
});

context.ChildPersClass = PersClass.inherit({
	initialize : function(ref, value, persRef, name) {
		this.superCall(ref, value, persRef);

		this.name = name;
	}
});

context.OtherPersClass = Object.inherit({
	initialize : function(value) {
		this.value = value;
	}
});

var schema = [ {
	"class" : "/db/test.persistent.PersClass",
	"fields" : {
		"ref" : "/db/test.persistent.OtherPersClass",
		"name" : "/db/_native.Integer",
		"persRef" : "/db/test.persistent.PersClass"
	}
}, {
	"class" : "/db/test.persistent.ChildPersClass",
	"superClass" : "/db/test.persistent.PersClass",
	"fields" : {
		"name" : "/db/_native.String"
	}
}, {
	"class" : "/db/test.persistent.OtherPersClass",
	"fields" : {
		"value" : "/db/_native.Integer"
	}
} ];

var factory = new jspa.EntityManagerFactory('http://localhost:8080');
//factory.define(schema);

var pu = factory.persistenceUnitUtil;
var em = factory.createEntityManager();

var id;
em.yield(function() {
	var ref = new PersClass(null, 202, null);
	var p1 = new PersClass(null, 101, ref);

	em.persist(p1);
	em.flush(function() {
		id = pu.getIdentifier(p1);
		console.log(id);
	});

	em.refresh(p1, function() {
		console.log(ref == p1.persRef);
		p1.name = 303;
		em.flush();
	});
});

em.clear();

em.transaction.begin(function() {
	em.find(PersClass, id, function(e, obj) {
		console.log(obj.name);
		em.refresh(obj, function() {
			console.log(obj.name);
		});
	});
	em.transaction.commit();
});

em.transaction.begin(function() {
	var ref = new PersClass(null, 202, null);
	var p1 = new PersClass(null, 101, ref);

	em.persist(p1);
	em.flush();

	em.refresh(p1, function() {
		console.log(ref == p1.persRef);
		id = pu.getIdentifier(p1);
		console.log(id);
	});
});
em.transaction.commit();

em.clear();

em.yield(function() {
	console.log('ID:' + id);
	em.find(PersClass, id, function(e, obj) {
		console.log(obj.name);

		if (!pu.isLoaded(obj, 'persRef')) {
			em.refresh(obj.persRef, function() {
				var ref = obj.persRef;
				console.log(ref.value);

				ref.name = 'buh';
			});
		} else {
			var ref = obj.persRef;
			console.log(ref.value);

			ref.name = 'buh';
		}
	});
});

em.yield(function() {
	var query = em.createQuery(null, PersClass);
	query.maxResults = 3;
	query.getResultList(function(e, result) {
		console.log('first 3 Persons:');
		for ( var i = 0, pers; pers = result[i]; ++i) {
			console.log('ID: ' + pu.getIdentifier(pers) + ': ' + pers.name);
		}
	});
});

em.yield(function() {
	var cls = new PersClass(null, 100, null);

	em.persist(cls);
	em.flush(function() {
		id = pu.getIdentifier(cls);
		em.detach(cls);
		em.find(PersClass, id, function(e, entity) {
			console.log(cls != entity);
			cls.name = 200;
			em.merge(cls, function(e, merged) {
				console.log(merged == entity);
				console.log(merged.name == 200);
				em.flush();
			});
		});
	});
});

em.yield(function() {
	var query = em.createQuery(null, PersClass);
	query.getResultList(function(e, result) {
		for ( var i = 0, pers; pers = result[i]; ++i) {
			em.remove(pers);
		}
		em.flush();
	});
});