const createMediaReplicationStream = require('blob-store-replication-stream')
const Syncfile = require('osm-p2p-syncfile')
const debug = require('debug')('mapeo-sync')
const Swarm = require('discovery-swarm')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const randombytes = require('randombytes')
const pump = require('pump')
const hcrypto = require('hypercore-crypto')
const crypto = require('crypto')
const datDefaults = require('dat-swarm-defaults')
const PeerChannel = require('./lib/peer-channel')
const progressSync = require('./lib/db-sync-progress')
const util = require('./lib/util')
const errors = require('./lib/errors')

const SYNC_VERSION = 3

const SYNC_DEFAULT_KEY = 'mapeo-sync'
const SYNCFILE_FORMATS = {
  'hyperlog-sneakernet': 1,
  'osm-p2p-syncfile': 2
}

const DEFAULT_LOCAL_DISCO = {
  dns: {
    interval: 3000
  },
  dht: false,
  utp: false
}

const DEFAULT_INTERNET_DISCO = Object.assign(
  {},
  datDefaults(),
  {
    dns: {
      interval: 3000
    }
  }
)

const states = {
  READY: 'replication-wifi-ready',
  PROGRESS: 'replication-progress',
  COMPLETE: 'replication-complete',
  ERROR: 'replication-error',
  STARTED: 'replication-started'
}

const multifeedErrorProps = ['code', 'usVersion', 'themVersion', 'usClient', 'themClient']

function PeerState (topic, message, other) {
  return { topic, message, ...other }
}

class Peer {
  constructor (type) {
    this.type = type
    this.sync = new EventEmitter()
    this.state = states.READY
    this.error = null
  }
}

class SyncState {
  constructor () {
    this._completed = {}
    this._state = {}
  }

  add (peer) {
    var onstart = () => this.onstart(peer)
    var onerror = (error) => this.onerror(peer, error)
    var onend = () => {
      this.remove(peer)
      peer.sync.removeListener('sync-start', onstart)
      peer.sync.removeListener('end', onend)
      peer.sync.removeListener('error', onerror)
      if (peer.sync.onprogress) peer.sync.removeListener('progress', peer.sync.onprogress)
    }

    peer.sync.on('sync-start', onstart)
    peer.sync.on('error', onerror)
    peer.sync.on('end', onend)
    this._state[peer.id] = peer
  }

  remove (peer) {
    if (this._isclosed(peer)) return
    if (peer.started) {
      peer.state = PeerState(states.COMPLETE, Date.now())
      this._completed[peer.name] = Object.assign({}, peer)
    }
    delete this._state[peer.id]
  }

  addProgressEventListeners (peer) {
    peer.sync.onprogress = (progress) => this.onprogress(peer, progress)
    peer.sync.on('progress', peer.sync.onprogress)
  }

  get (host, port) {
    var res = Object.values(this._state)
      .filter(function (peer) {
        return peer.port === port && peer.host === host
      })
    if (res.length) {
      return res[0]
    } else {
      return null
    }
  }

  _isclosed (peer) {
    return peer.state.topic === states.COMPLETE || peer.state.topic === states.ERROR
  }

  addWifiPeer (peer) {
    peer.state = PeerState(states.READY)
    this.add(peer)
  }

  addFilePeer (peer) {
    this.onstart(peer)
    this.add(peer)
    this.addProgressEventListeners(peer)
  }

  onstart (peer) {
    peer.started = true
    peer.state = PeerState(states.STARTED)
  }

  onprogress (peer, progress) {
    if (this._isclosed(peer)) return
    peer.state = PeerState(states.PROGRESS, progress)
  }

  onerror (peer, error) {
    if (this._isclosed(peer)) return
    const errorMetadata = {}
    multifeedErrorProps.forEach(key => {
      if (error[key]) errorMetadata[key] = error[key]
    })
    peer.state = PeerState(states.ERROR, error ? error.toString() : 'Error', errorMetadata)
  }

  peers () {
    var self = this
    var peers = []
    Object.values(this._state).map((peer) => {
      var completed = self._completed[peer.name]
      if (completed) peer.state.lastCompletedDate = completed.state.message
      peers.push(peer)
    })
    Object.values(this._completed).map((peer) => {
      if (!(peers.find((p) => p.name === peer.name))) peers.push(peer)
    })
    return peers
  }
}

class Sync extends EventEmitter {
  constructor (osm, media, opts) {
    super()
    opts = Object.assign(opts.internetDiscovery ? DEFAULT_INTERNET_DISCO : DEFAULT_LOCAL_DISCO, opts)
    opts.writeFormat = opts.writeFormat || 'osm-p2p-syncfile'
    if (!SYNCFILE_FORMATS[opts.writeFormat]) {
      throw new errors.UnsupportedSyncfileError(opts.writeFormat)
    }

    this.osm = osm
    this.media = media
    this.name = opts.name
    this.id = opts.id || randombytes(32)
    this.opts = Object.assign({}, opts)

    this._activeSyncs = 0
    // track all peer states
    this.state = new SyncState()
  }

  peers () {
    return this.state.peers()
  }

  replicate ({host, port, filename}, opts) {
    if (!opts) opts = {}

    if (host && port) {
      port = parseInt(port)
      const peer = this.state.get(host, port)
      if (!peer) {
        let emitter = new EventEmitter()
        process.nextTick(() => {
          emitter.emit('error', new errors.PeerNotFoundError())
        })
        return emitter
      }
      this.replicateNetwork(peer, opts)
      return peer.sync
    } else if (filename) {
      const peer = new FilePeer(filename)
      this.state.addFilePeer(peer)
      this.replicateFromFile(peer, opts)
      return peer.sync
    } else {
      let emitter = new EventEmitter()
      process.nextTick(() => {
        emitter.emit('error', new errors.PeerNotFoundError())
      })
      return emitter
    }
  }

  replicateNetwork (peer, opts) {
    if (!peer.sync) {
      process.nextTick(function () {
        peer.sync.emit('error', new errors.PrematureSyncError())
      })
      return peer.sync
    }

    // return existing emitter
    if (peer.syncing) return peer.sync

    peer.doSync()
    peer.syncing = true
    return peer.sync
  }

  listen (cb) {
    if (!cb) cb = () => {}
    if (this.swarm || this._destroyingSwarm) {
      return process.nextTick(cb)
    }
    this.state = new SyncState()
    this.swarm = this._swarm()
    process.nextTick(cb)
  }

  leave (projectKey) {
    var key = discoveryKey(projectKey)
    this.swarm.leave(key)
  }

  join (projectKey) {
    var key = discoveryKey(projectKey)
    this.swarm.join(key)
  }

  destroy (cb) {
    this.close(cb)
  }

  close (cb) {
    if (!cb) cb = () => {}
    if (!this.swarm || this._destroyingSwarm) return process.nextTick(cb)
    this._destroyingSwarm = true
    this.swarm.destroy(() => {
      this.swarm = null
      this._destroyingSwarm = false
      cb()
    })
  }

  /**
   * Replicate from a given file. Use `replicate` instead.
   * @param  {{filename:string, sync?:EventEmitter}} peer    A peer.
   * @return {EventEmitter}     Listen to 'error', 'end' and 'progress' events
   */
  replicateFromFile (peer, opts) {
    var self = this
    var emitter = peer.sync
    var filename = peer.filename
    opts = opts || {}

    fs.access(filename, function (err) {
      if (err) { // file doesn't exist, write
        if (self.opts.writeFormat === 'osm-p2p-syncfile') sync()
        else return onerror(new errors.UnsupportedSyncfileError())
      } else { // read
        isGzipFile(filename, function (err, isGzip) {
          if (err) return onerror(err)
          if (!isGzip) sync()
          else return onerror(new errors.UnsupportedSyncfileError())
        })
      }
    })

    function sync () {
      const discoKey = discoveryKey(opts.projectKey)
      const syncfile = new Syncfile(filename, os.tmpdir())
      syncfile.ready(function (err) {
        if (err) return onerror(err)
        syncfile.userdata(function (err, data) {
          if (err) return onerror(err)
          if (data && data['p2p-db'] && data['p2p-db'] !== 'kappa-osm') {
            return onerror(new errors.UnsupportedSyncfileError(data['p2p-db']))
          }
          if (data && data.discoveryKey && opts.projectKey && data.discoveryKey !== discoKey) {
            return onerror(new errors.IncompatibleProjectsError())
          }

          self.osm.ready(start)
        })
      })

      function start () {
        const remoteState = util.mfState(syncfile._mfeed)
        const localState = util.dbState(self.osm)
        const expectedDown = util.getExpectedDownloadEvents(localState, remoteState)
        const expectedUp = util.getExpectedUploadEvents(localState, remoteState)

        const r1 = syncfile.replicateData(true, {live: false})
        const r2 = progressSync(false, self, {live: false})
        r2.setTotals(expectedDown, expectedUp)
        const m1 = syncfile.replicateMedia()
        const m2 = createMediaReplicationStream(self.media)
        var error
        var pending = 2
        pump(r1, r2, r1, fin)
        pump(m1, m2, m1, fin)
        function fin (err) {
          // HACK(noffle): workaround for sync bug
          if (err && err.message === 'premature close') err = undefined

          if (err) error = err
          if (!--pending) {
            var userdata = {
              'p2p-db': 'kappa-osm'
            }
            if (opts.projectKey) userdata.discoveryKey = discoKey
            syncfile.userdata(userdata, function (err) {
              error = error || err
              syncfile.close(function (err) {
                error = error || err
                onend(error)
              })
            })
          }
        }

        // track sync progress
        var progress = {
          db: { sofar: 0, total: 0 },
          media: { sofar: 0, total: 0 }
        }
        r2.on('progress', function (sofar, total) {
          progress.db.sofar = sofar
          progress.db.total = total
          emitter.emit('progress', progress)
        })
        m2.on('progress', function (sofar, total) {
          progress.media.sofar = sofar
          progress.media.total = total
          emitter.emit('progress', progress)
        })
      }
    }

    function onerror (err) {
      emitter.emit('error', err)
    }

    function onend (err) {
      if (err) return onerror(err)
      self.osm.ready(function () {
        emitter.emit('end')
      })
    }

    return emitter
  }

  setName (name) {
    this.name = name
  }

  _swarm () {
    const swarmId = crypto.createHash('sha256').update(this.id).digest()
    var opts = Object.assign(this.opts, {
      keepExistingConnections: true,
      id: swarmId
    })
    var swarm = Swarm(opts)

    swarm.on('connection', this.onConnection.bind(this))
    return swarm
  }

  onConnection (connection, info) {
    const self = this
    const peerId = info.id.toString('hex')
    let peer
    debug('connection made', info.host, info.port)

    function onClose (err) {
      if (peer) {
        debug('emitting sync event', peer.host, peer.port, err)
        self.emit('down', peer)
      }
      debug('connection ended', info.host, info.port)
    }

    const channel = new PeerChannel({
      osm: self.osm,
      media: self.media,
      connection: connection,
      isInitiator: info.initiator,
      handshakePayload: {
        id: peerId,
        deviceType: self.opts.deviceType,
        deviceName: self.name || os.hostname(),
        protocolVersion: SYNC_VERSION
      }
    })

    channel.once('end', () => {
      debug('connection ended gracefully', info.host, info.port)
      onClose()
    })

    channel.once('error', err => {
      debug('connection dropped', info.host, info.port)
      onClose(err)
    })

    channel.once('handshake-complete', req => {
      peer = new WifiPeer(connection, info, req.deviceName, req.deviceType)
      // TODO: can maybe do s/self/this?
      self.state.addWifiPeer(peer)
      self.emit('peer', peer)
      self.state.addProgressEventListeners(peer)

      // start a new sync
      peer.doSync = function () {
        const sync = channel.sync()

        debug('sync started', info.host, info.port)
        if (++self._activeSyncs === 1) {
          self.osm.core.pause(function () {
            if (peer) peer.sync.emit('sync-start')
          })
        }

        sync.once('end', () => {
          debug('sync ended', info.host, info.port)
          if (--self._activeSyncs === 0) {
            self.osm.core.resume()
          }
          peer.sync.emit('end')
        })

        sync.once('error', err => {
          debug('sync ended with error', err, info.host, info.port)
          if (--self._activeSyncs === 0) {
            self.osm.core.resume()
          }
          peer.sync.emit('error', err)
        })

        sync.on('progress', (progress) => {
          debug('sync progress', info.host, info.port, progress)
          if (peer) peer.sync.emit('progress', progress)
        })
      }
    })
  }
}

function isGzipFile (filepath, cb) {
  fs.access(filepath, function (err) {
    if (err) return cb(null, false)
    fs.open(filepath, 'r', function (err, fd) {
      if (err) return cb(err)
      var magic = Buffer.alloc(2)
      fs.read(fd, magic, 0, 2, 0, function (err) {
        if (err) return cb(err)
        const isGzip = (magic.toString('hex') === '1f8b')
        fs.close(fd, function (err) {
          if (err) return cb(err)
          cb(null, isGzip)
        })
      })
    })
  })
}

function FilePeer (filename) {
  this.type = 'file'
  this.id = filename
  this.filename = filename
  this.sync = new EventEmitter()
}

function WifiPeer (connection, info, name, deviceType) {
  this.type = 'wifi'
  this.id = info.id.toString('hex')
  this.host = info.host
  this.port = info.port
  this.connection = connection
  this.name = name
  this.deviceType = deviceType
  this.sync = new EventEmitter()
}

/**
 * Generate a discovery key for a given projectKey. If projectKey is undefined
 * then it will use SYNC_DEFAULT_KEY as the discovery key (this is for backwards
 * compatibility with clients that did not use projectKeys)
 *
 * @param {String|Buffer} projectKey A unique random key identifying the
 * project. Must be 32-byte Buffer or a string hex encoding of a 32-Byte buffer
 */
function discoveryKey (projectKey) {
  if (typeof projectKey === 'undefined') return SYNC_DEFAULT_KEY

  if (typeof projectKey === 'string' && projectKey.length === 64) {
    projectKey = Buffer.from(projectKey, 'hex')
  } else if (Buffer.isBuffer(projectKey) && projectKey.length === 32) {
    return hcrypto.discoveryKey(projectKey).toString('hex')
  } else {
    throw new errors.MalformedProjectKeyError(projectKey)
  }
}

module.exports = Sync
