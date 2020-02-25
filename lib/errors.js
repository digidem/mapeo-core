class MapeoError extends Error {
  constructor (code, message, innerError) {
    super(message)
    this.code = code
    this.message = message
    this.err = innerError
  }
}

const ERR_PEER_NOT_FOUND              = 'ERR_PEER_NOT_FOUND'
const ERR_DIFF_PROJECT_KEYS           = 'ERR_DIFF_PROJECT_KEYS'
const ERR_PREMATURE_SYNC              = 'ERR_PREMATURE_SYNC'
const ERR_UNSUPPORTED_SYNCFILE_FORMAT = 'ERR_UNSUPPORTED_SYNCFILE_FORMAT'
const ERR_CONNECTION_LOST             = 'ERR_CONNECTION_LOST'
const ERR_SYNC                        = 'ERR_SYNC'
const ERR_MALFORMED_PROJECT_KEY       = 'ERR_MALFORMED_PROJECT_KEY'

class PeerNotFoundError extends MapeoError {
  constructor (innerError) {
    super(ERR_PEER_NOT_FOUND, 'peer was not found', innerError)
  }
}

class IncompatibleProjectsError extends MapeoError {
  constructor (innerError) {
    super(ERR_DIFF_PROJECT_KEYS, 'remote project key is different than ours', innerError)
  }
}

class PrematureSyncError extends MapeoError {
  constructor (innerError) {
    super(ERR_PREMATURE_SYNC,  'sync started before handshake finished', innerError)
  }
}

class UnsupportedSyncfileError extends MapeoError {
  constructor (format, innerError) {
    super(ERR_UNSUPPORTED_SYNCFILE_FORMAT, 'syncfile type is not supported ('+format+')', innerError)
  }
}

class ConnectionLostError extends MapeoError {
  constructor (innerError) {
    super(ERR_CONNECTION_LOST, 'peer network connection lost', innerError)
  }
}

class SyncError extends MapeoError {
  constructor (message, innerError) {
    super(ERR_SYNC, message || 'sync failed', innerError)
  }
}

class MalformedProjectKeyError extends MapeoError {
  constructor (key, innerError) {
    super(ERR_MALFORMED_PROJECT_KEY, 'project key is malformed', innerError)
    this.key = truncateKey(key)
  }
}

module.exports = {
  PeerNotFoundError,
  IncompatibleProjectsError,
  PrematureSyncError,
  UnsupportedSyncfileError,
  ConnectionLostError,
  SyncError,
  MalformedProjectKeyError,
  ERR_PEER_NOT_FOUND,
  ERR_DIFF_PROJECT_KEYS,
  ERR_PREMATURE_SYNC,
  ERR_UNSUPPORTED_SYNCFILE_FORMAT,
  ERR_CONNECTION_LOST,
  ERR_SYNC,
  ERR_MALFORMED_PROJECT_KEY
}

function truncateKey (key) {
  if (Buffer.isBuffer(key)) key = key.toString('hex')
  if (typeof key === 'string') return key.substring(0,5) + '..'
  else return ''
}
