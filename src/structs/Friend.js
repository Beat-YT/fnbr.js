const User = require('./User');
const Party = require('./Party');

/**
 * Represents an Epic Games friend of a client
 * @extends {User}
 */
class Friend extends User {
  /**
   * @param {Client} client The main client
   * @param {Object} data The friend data
   */
  constructor(client, data) {
    super(client, data);

    /**
     * The connections of the friend
     * @type {Array}
     */
    this.connections = data.connections || [];

    /**
     * The count of mutual friends
     * @type {number}
     */
    this.mutualFriends = data.mutual || 0;

    /**
     * Whether this friend is a favourite one or not
     * @type {boolean}
     */
    this.favorite = data.favorite || false;

    /**
     * The date when the friendship was created
     * @type {Date}
     */
    this.createdAt = data.created ? new Date(data.created) : undefined;

    /**
     * The note for this friend
     * @type {string}
     */
    this.note = data.note || '';

    /**
     * The alias of this friend
     * @type {string}
     */
    this.alias = data.alias || '';

    /**
     * The last recieved presence of this friend
     * @type {FriendPresence}
     */
    this.presence = data.presence;
  }

  /**
   * Whether a user is online or not
   * Can be inaccurate as it uses the receive date of the last presence
   * @type {boolean}
   * @readonly
   */
  get isOnline() {
    if (!this.presence) return false;
    return this.presence.recievedAt.getTime() > (Date.now() - 120000);
  }

  /**
   * Whether the client can join this friend's party or not
   * May be slighly inaccurate as it uses the last received presence
   * @type {boolean}
   * @readonly
   */
  get isJoinable() {
    if (!this.isOnline || !this.presence.partyData.id) return false;
    return !this.presence.partyData.isPrivate;
  }

  /**
   * Removes this friend
   * @returns {Promise<void>}
   */
  async remove() {
    await this.client.removeFriend(this.id);
  }

  /**
   * Sends a message to this friend
   * @param {String} message The message that will be sent
   * @returns {Promise<FriendMessage>}
   */
  async sendMessage(message) {
    return this.client.sendFriendMessage(this.id, message);
  }

  /**
   * Sends a party invitation to this friend
   * @returns {Promise<SentPartyInvitation>}
   */
  async invite() {
    if (!this.client.party) throw new Error(`Failed sending party invitation to ${this.id}: Client is not in a party`);
    return this.client.party.invite(this.id);
  }

  /**
   * Blocks this friend
   * @returns {Promise<void>}
   */
  async block() {
    await this.client.blockUser(this.id);
  }

  /**
   * Joins this friend's party
   * @returns {Promise<void>}
   */
  async joinParty() {
    if (!this.isJoinable) throw new Error('Cannot join friend party: Party not joinable');
    const party = await Party.Lookup(this.client, this.presence.partyData.id);
    await party.join();
  }
}

module.exports = Friend;
