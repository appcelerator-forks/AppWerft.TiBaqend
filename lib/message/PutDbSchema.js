var Message = require('./Message').Message;
var CommunicationError = require('../error').CommunicationError;

/**
 * @class jspa.message.PutDbSchema
 * @extends jspa.message.Message
 */
exports.PutDbSchema = PutDbSchema = Message.inherit(/** @lends jspa.message.PutDbSchema.prototype */ {
	/**
   * @param {Object} jsonSchema
	 */
	initialize: function(jsonSchema) {
		this.superCall('put', '/db/schema', jsonSchema);
	},
	
	doReceive: function() {
		if (this.response.statusCode != 200) {
			throw new CommunicationError(this);
		}
	}
});