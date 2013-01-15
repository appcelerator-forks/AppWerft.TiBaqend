jspa.message.Message = Object.inherit(util.EventTarget, {
	/**
	 * @constructor
	 * @memberOf jspa.message.Message
	 * @param path
	 */
	initialize: function(method, path, requestEntity) {
		this.request = {
			method: method,
			path: path,
			headers: {
				'accept': 'application/json'
			},
			entity: requestEntity? requestEntity: null
		};
		
		this.response = {
			statusCode: 0,
			headers: {},
			entity: null
		};
	},
	
	send: function() {
		try {
			this.doSend();
			return this.trigger('send');
		} catch (e) {
			if (!e.isInstanceOf(jspa.error.PersistentError))
				e = new jspa.error.PersistentError(e.message, e);
			
			this.trigger(e);
			return false;
		}
	},
	
	receive: function() {
		try {
			this.doReceive();
			this.trigger('receive');
		} catch (e) {
			if (!e.isInstanceOf(jspa.error.PersistentError))
				e = new jspa.error.PersistentError(e.message, e);
			
			this.trigger(e);
		}
	},
	
	doSend: function() {
	},
	
	doReceive: function() {
	}
});