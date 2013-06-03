jspa.message.PutObject = jspa.message.Message.inherit({
	/**
	 * @constructor
	 * @super jspa.message.TransactionalMessage
	 * @memberOf jspa.message.PutObject
	 * @param {jspa.Transaction} transaction
	 * @param {jspa.util.State} state
	 */
	initialize: function(state) {
		this.superCall('put', state.getIdentifier());
		
		this.state = state;
	},
	
	doSend: function() {
		var version = this.state.getVersion();
		if (version) {
			Object.extend(this.request.headers, {
				'if-match': version == '*'? version: '"' + version + '"'
			});
		}
		
		this.request.entity = this.state.getDatabaseObject();
	},
	
	doReceive: function() {
		switch (this.response.statusCode) {
			case 200:
				this.state.setDatabaseObjectInfo(this.response.entity['_objectInfo']);
				//mark as persistent in next case
			case 202:
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