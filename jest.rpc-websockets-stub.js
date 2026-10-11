// @solana/web3.js requires rpc-websockets at load time for its subscription client. Tests never open a socket.
class Client {}
module.exports = { Client, CommonClient: Client };
