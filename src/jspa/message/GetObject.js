jspa.message.GetObject = jspa.message.Message.inherit({
	/**
	 * @constructor
	 * @super jspa.message.TransactionalMessage
	 * @memberOf jspa.message.GetObject
	 * @param {jspa.Transaction} transaction
	 * @param {jspa.util.State} state
	 * @param {Boolean} useTransactionalView
	 */
	initialize: function(state, tid) {
		var id = state.getDatabaseValue(state.model.id);
		
		if (tid) {
			id = id.replace('/db/', '/transaction/' + tid + '/dbview/');
		}
		
		this.superCall('get', id);
		
		this.state = state;
	},
	
	doSend: function() {
		var version = this.state.getDatabaseValue(this.state.model.version);
		if (version) {			
			Object.extend(this.request.headers, {
				'cache-control': 'max-age=0, no-cache',
				'pragma': 'no-cache'
			});
			
			// we can revalidate if the object is not dirty
			if (this.state.isPersistent) {				
				this.request.headers['if-none-match'] = version == '*'? version: '"' + version + '"';
			}
		}
		
		this.request.entity = this.state.getDatabaseObject();
	},
	
	doReceive: function() {
		switch (this.response.statusCode) {
			case 304:			
				break;
			case 200:
				this.state.setDatabaseObject(this.response.entity);
				this.state.setPersistent();
				break;
			case 404:
				this.state.setDeleted();
				break;
			default:
				throw new jspa.error.CommunicationError(this);
		}
	}
});