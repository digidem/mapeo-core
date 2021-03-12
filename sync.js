const createMediaReplicationStream = require('blob-store-replication-stream')
const Syncfile = require('osm-p2p-syncfile')
const debug = require('debug')('mapeo-sync')
const Swarm = require('discovery-swarm')
const events = require('events')
const fs = require('fs')
const os = require('os')
const randombytes = require('randombytes')
const pump = require('pump')
const crypto = require('hypercore-crypto')
const datDefaults = require('dat-swarm-defaults')
const MapeoSync = require('./lib/sync-stream')
const progressSync = require('./lib/db-sync-progress')
const websocket = require('websocket-stream')

// This is an insecure discovery key that will discover all local devices that
// don't have a project key in their configuration
const SYNC_DEFAULT_KEY = 'mapeo-sync'

// hyperlog-sneakernet is an old format that is no longer supported.
// osm-p2p-syncfile is the supported implementation.
// See https://www.npmjs.com/package/osm-p2p-syncfile module for more details
const SYNCFILE_FORMATS = {
  'hyperlog-sneakernet': 1,
  'osm-p2p-syncfile'   : 2
}

// When connecting to a local network, use these
// options for discovery-swarm
const DEFAULT_LOCAL_DISCO = {
  dns: {
    interval: 3000
  },
  dht: false,
  utp: false
}

// When internet connectivity is on, use these
// options for discovery-swarm
//
// Internet Discovery is not yet enabled by Desktop or Mobile
// TODO: in production, we should not use datDefaults because
// it depends on some servers that mafintosh maintains
const DEFAULT_INTERNET_DISCO = Object.assign(
  {},
  datDefaults(),
  {
    dns: {
      interval: 3000
    }
  }
)

// When a sync fails to finish, and one of the feeds in the database (a hypercore feed)
// is incomplete, sync will throw this error after 20 seconds of inactive replication
const ERR_MISSING_DATA = 'ERR_MISSING_DATA'
const DEFAULT_HEARTBEAT_INTERVAL = 1000 * 20 // 20 seconds

// Available states for displaying syncronization progress to clients
const ReplicationState = {
  WIFI_READY: 'replication-wifi-ready',
  PROGRESS: 'replication-progress',
  COMPLETE: 'replication-complete',
  ERROR: 'replication-error',
  STARTED: 'replication-started'
}

// These properties will be passed to the client when there is an error
const multifeedErrorProps = ['code', 'usVersion', 'themVersion', 'usClient', 'themClient']

// Simple wrapper for the PeerState object
// that requires a topic and message
function PeerState (topic, message, other) {
  return { topic, message, ...other }
}

/**
 * Called by Sync.addPeer to add a peer to the SyncState
 * @param {DuplexStream} connection Duplex stream, but has only been tested in production using TCP
 * @param {Object} info 
 */
function WifiPeer (connection, info) {
  info.type = 'wifi'
  info.connection = connection
  info.swarmId = info.id // XXX: not used; for backwards compatibility
  info.id = info.id.toString('hex')
  return info
}

/**
 * Called by Sync.addPeer to add a peer to the SyncState
 * @param {DuplexStream} connection Duplex stream, but has only been tested in production using TCP
 * @param {Object} info 
 */
function WebsocketPeer (connection, info) {
  info.type = 'websocket'
  info.connection = connection
  info.swarmId = info.id
  return info
}

// SyncState is a state machine that manages the list of peers
// and their states, represented by PeerState objects
class SyncState {
  constructor () {
    this._state = {}
  }

  _add (peer) {
    peer.state = PeerState(ReplicationState.WIFI_READY)
    this.init(peer)
    this._state[peer.id] = peer
  }

  // Start tracking a peer's state
  // and include that peer in the list of all peers
  init (peer) {
    peer.started = false
    peer.connected = true
    peer.sync = new events.EventEmitter()
    var onsync = () => this.onsync(peer)
    var onerror = (error) => this.onerror(peer, error)
    var onend = () => {
      this.onend(peer)
      peer.sync.removeListener('sync-start', onsync)
      peer.sync.removeListener('end', onend)
      peer.sync.removeListener('error', onerror)
      if (peer.sync.onprogress) peer.sync.removeListener('progress', peer.sync.onprogress)
    }

    peer.sync.on('sync-start', onsync)
    peer.sync.on('error', onerror)
    peer.sync.on('end', onend)
  }

  // Progress event listeners are added after sync-start by
  // the caller of peer.add
  addProgressEventListeners (peer) {
    peer.sync.onprogress = (progress) => this.onprogress(peer, progress)
    peer.sync.on('progress', peer.sync.onprogress)
  }

  // Get a peer by it's host and port
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

  // We need to know if a peer has been hanging for a period of time
  // with no progress. This could happen if replication is opened
  // in non-sparse mode or live mode. It will then continue hanging and waiting
  // for updates until it is told to stop.
  stale (peer) {
    var NOT_STALE = [
      ReplicationState.STARTED,
      ReplicationState.ERROR,
      ReplicationState.COMPLETE,
      ReplicationState.WIFI_READY
    ]
    if (NOT_STALE.indexOf(peer.state.topic) > -1) return false

    // XXX: This is important because this peer can get in a state where it's in
    // progress but the other side has not yet acknowlegded to us that it has
    // finished downloading
    // we can remove this check once we have ACKs or proper backpressure
    var INCOMPLETE = peer.state.message.db.sofar !== peer.state.message.db.total ||
      peer.state.message.media.sofar !== peer.state.message.media.total
    var staleDate = Date.now() - DEFAULT_HEARTBEAT_INTERVAL
    return peer.state.topic === ReplicationState.PROGRESS &&
      (peer.state.message.timestamp < staleDate) && INCOMPLETE
  }

  _isactive (peer) {
    return peer.state.topic === ReplicationState.PROGRESS || peer.state.topic === ReplicationState.STARTED
  }

  _isclosed (peer) {
    return peer.state.topic === ReplicationState.COMPLETE || peer.state.topic === ReplicationState.ERROR
  }

  _iscomplete (peer) {
    return peer.state.topic === ReplicationState.COMPLETE
  }

  // Add a peer that was discovered via Wifi (contains a TCP socket)
  addWifiPeer (connection, info) {
    const peerId = info.id.toString('hex')
    let peer = this._state[peerId]
    if (!peer) {
      peer = WifiPeer(connection, info)
      this._add(peer)
    } else {
      // reuse peer
      this.init(peer)
    }
    return peer
  }

  // Add a peer that is a file
  addFilePeer (filename) {
    const peer = {
      id: filename,
      name: filename,
      filename
    }
    this._state[peer.id] = peer
    this._add(peer)
    this.addProgressEventListeners(peer)
    this.onsync(peer)
    return peer
  }

  addWebsocketPeer (connection, info) {
    const peerId = info.id.toString('hex')
    let peer = this._state[peerId]
    if (!peer) {
      peer = WebsocketPeer(connection, info)
      this._add(peer)
    } else {
      // reuse peer
      this.init(peer)
    }
    return peer
  }

  onsync (peer) {
    peer.started = true
    peer.state = PeerState(ReplicationState.STARTED)
    this.addProgressEventListeners(peer)
  }

  onprogress (peer, progress) {
    if (this._isclosed(peer)) return
    progress.timestamp = Date.now()
    peer.state = PeerState(ReplicationState.PROGRESS, progress)
  }

  onerror (peer, error) {
    if (this._isclosed(peer)) return
    peer.connected = false
    const errorMetadata = {}
    multifeedErrorProps.forEach(key => {
      if (error[key]) errorMetadata[key] = error[key]
    })
    peer.state = PeerState(ReplicationState.ERROR, error ? error.toString() : 'Error', errorMetadata)
  }

  onend (peer) {
    if (this._isclosed(peer)) return
    if (peer.started) {
      peer.state = PeerState(ReplicationState.COMPLETE, Date.now())
    }
  }

  // XXX: depends on 'peer' being a persistent reference
  peers () {
    return Object.values(this._state).map((peer) => {
      if (this._iscomplete(peer)) peer.state.lastCompletedDate = peer.state.message
      return peer
    })
  }
}

// Sync class manages discovery of peers and replication
class Sync extends events.EventEmitter {
  constructor (osm, media, opts) {
    super()
    opts = Object.assign(opts.internetDiscovery ? DEFAULT_INTERNET_DISCO : DEFAULT_LOCAL_DISCO, opts)
    opts.writeFormat = opts.writeFormat || 'osm-p2p-syncfile'
    if (!SYNCFILE_FORMATS[opts.writeFormat]) throw new Error('unknown syncfile write format: ' + opts.writeFormat)

    this.osm = osm
    this.media = media
    this.name = opts.name
    if (Buffer.isBuffer(opts.id)) this.id = opts.id.toString('hex')
    else if (typeof opts.id === 'string') this.id = opts.id
    else if (!opts.id) this.id = randombytes(32).toString('hex')
    else throw new Error('opts.id must be a string or buffer')
    this.opts = Object.assign({}, opts)

    // track all peer states
    this.state = new SyncState()
  }

  peers () {
    return this.state.peers()
  }

  /**
   * Replicate with a given filename or host/port. 
   * If you are using this function to replicate with a Wifi peer (tcp socket) then
   * this function needs to be called AFTER addPeer(socket, info)
   * 
   * This could be refactored.
   * 
   * @param {PeerQuery} A query for the peer
   * @param {Object} opts Options for the replication 
   */
  replicate ({host, port, filename}, opts) {
    if (!opts) opts = {}
    var peer

    if (host && port) {
      port = parseInt(port)
      peer = this.state.get(host, port)
      if (!peer) {
        var emitter = new events.EventEmitter()
        process.nextTick(() => {
          emitter.emit('error', new Error('trying to sync to unknown peer'))
        })
        return emitter
      }
      this.replicateNetwork(peer, opts)
    } else if (filename) {
      peer = this.state.addFilePeer(filename)
      this.replicateFromFile(peer, opts)
    } else throw new Error('Requires filename or host and port')

    return peer.sync
  }

  connectWebsocket (url, projectKey) {
    let {
      protocol,
      hostname: host,
      port: rawPort
    } = new URL(url)

    let port = rawPort
    if (!port) {
      port = (protocol === 'ws:') ? 80 : 443
    } else {
      port = parseInt(rawPort, 10)
    }

    const info = {
      id: url,
      name: url,
      host,
      port,
      type: 'websocket'
    }

    var key = discoveryKey(projectKey)

    const replicationURL = (new URL(`./replicate/v1/${key}`, url)).href

    const connection = websocket(replicationURL, { binary: true })

    const peer = this.state.addWebsocketPeer(connection, info)

    this.addPeer(connection, info)

    return peer
  }

  // replicateNetwork on a peer that already exists (from sync.peers())
  replicateNetwork (peer, opts) {
    if (!peer.handshake) {
      process.nextTick(() => {
        peer.sync.emit('error', new Error('trying to sync before handshake has occurred'))
      })
      return peer.sync
    }

    if (!peer.connected) {
      process.nextTick(() => {
        peer.sync.emit('error', new Error('trying to sync to a peer that is not connected'))
      })
      return peer.sync
    }

    peer.handshake.accept()
    delete peer.handshake
    return peer.sync
  }

  // Start listening on discovery swarm
  listen (cb) {
    if (!cb) cb = () => {}
    if (this.swarm && !this._destroyingSwarm) {
      return process.nextTick(cb)
    }

    const _listen = () => {
      this.osm.ready(() => {
        this.osm.core._logs.writer('default', (err, feed) => {
          if (err) return cb(err)
          this.swarm = this._swarm(feed.key)
          this.swarm.listen(0, err => {
            if (err) return cb(err)
            cb()
            this.emit('listen')
          })
        })
      })
    }

    if (this._destroyingSwarm) this.once('close', _listen)
    else _listen()
  }

  // Stop listening for project key
  leave (projectKey) {
    var key = discoveryKey(projectKey)
    debug('sync leave')
    if (this.swarm) this.swarm.leave(key)
    else {
      debug('sync leaving silently')
      return
    }
  }

  // Start listening for project key
  join (projectKey) {
    const key = discoveryKey(projectKey)
    const join = () => this.swarm.join(key)

    if (!this.swarm) this.once('listen', join)
    else join()
  }

  // Alias for close
  destroy (cb) {
    this.close(cb)
  }

  // Destroy everything (all tcp sockets and swarms)
  close (cb) {
    if (!cb) cb = () => {}
    if (!this.swarm || this._destroyingSwarm) return process.nextTick(cb)
    this._destroyingSwarm = true
    this.swarm.destroy(() => {
      this.swarm = null
      this._destroyingSwarm = false
      this.emit('close')
      cb()
    })
  }

  /**
   * Replicate from a given file. Use `replicate` instead.
   * @param  {String}   peer    A peer.
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
        else return onerror(new Error('unsupported syncfile type'))
      } else { // read
        isGzipFile(filename, function (err, isGzip) {
          if (err) return onerror(err)
          if (!isGzip) sync()
          else return onerror(new Error('unsupported syncfile type'))
        })
      }
    })

    function sync () {
      const discoKey = discoveryKey(opts.projectKey)
      const syncfile = new Syncfile(filename, os.tmpdir(), { encryptionKey: opts.projectKey })
      syncfile.ready(function (err) {
        if (err) return onerror(err)
        syncfile.userdata(function (err, data) {
          if (err) return onerror(err)
          if (data && data['p2p-db'] && data['p2p-db'] !== 'kappa-osm') {
            return onerror(new Error('trying to sync this kappa-osm database with a ' + data['p2p-db'] + ' database!'))
          }
          if (data && data.discoveryKey && opts.projectKey && data.discoveryKey !== discoKey) {
            return onerror(new Error(`trying to sync two different projects (us=${discoKey}) (syncfile=${data.discoveryKey})`))
          }
          start()
        })
      })

      function start() {
        const r1 = syncfile.replicateData({live: false})
        const r2 = progressSync(self, {live: false})
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
            syncfile.userdata(userdata, function () {
              syncfile.close(onend.bind(null, error))
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
        self.emit('down', peer)
        emitter.emit('end')
      })
    }

    return emitter
  }

  setName (name) {
    this.name = name
  }

  _swarm (id) {
    var swarm = Swarm(Object.assign(this.opts, {id: id}))

    swarm.on('connection', this.addPeer.bind(this))
    return swarm
  }

  /**
   * Add a peer to the list of available peers. Must be called before `replicate`
   * 
   * @param {DuplexStream} connection This is a duplex stream, although it has only been tested in production with TCP sockets.  
   * @param {Object} info This is an object that contains information about the TCP socket, including a unique, persistent id, as well as host, and port
   */
  addPeer (connection, info) {
    var self = this
    debug('connection', info.host, info.port, info.id.toString('hex'))

    let peer
    let deviceType
    let disconnected = false
    let heartbeat

    connection.on('close', onClose)
    connection.on('error', onClose)

    var open = true
    var stream
    setTimeout(doSync, 500)

    function onClose (err) {
      disconnected = true
      if (peer) peer.connected = false
      if (heartbeat) clearInterval(heartbeat)
      debug('onClose', info.host, info.port, err)
      if (!open) return
      open = false
      if (peer) {
        debug('emitting sync end/error event', info.host, info.port, err)
        if (err) peer.sync.emit('error', err)
        else peer.sync.emit('end')
        self.emit('down', peer)
      }
      debug('down', info.host, info.port)
    }

    function doSync () {
      if (!open || disconnected) return
      debug('doSync', info.host, info.port)
      // Set up the sync stream immediately, but don't do anything with it
      // until one side initiates the sync operation.
      deviceType = self.opts.deviceType
      const id = Buffer.isBuffer(info.id) ? info.id.toString('hex') : info.id
      stream = MapeoSync(self.osm, self.media, {
        id: id,
        deviceType: deviceType,
        deviceName: self.name || os.hostname(),
        handshake: onHandshake
      })
      stream.once('sync-start', function () {
        debug('sync started', info.host, info.port)
        if (peer) peer.sync.emit('sync-start')
        self.osm.core.pause()
        // XXX: This is a hack to ensure sync streams always end eventually
        // Ideally, we'd open a sparse hypercore instead.
        heartbeat = setInterval(() => {
          var stale = self.state.stale(peer)
          if (stale) {
            var err = new Error('timed out due to missing data')
            err.code = ERR_MISSING_DATA
            connection.destroy(err)
          }
          debug('heartbeat', stale)
        }, DEFAULT_HEARTBEAT_INTERVAL)
      })
      stream.on('progress', (progress) => {
        debug('sync progress', info.host, info.port, progress)
        if (peer) peer.sync.emit('progress', progress)
      })

      pump(stream, connection, stream, function (err) {
        debug('pump ended', info.host, info.port, err)
        if (peer && peer.started) {
          self.osm.core.resume()
        }
        if (peer && peer.started && !stream.goodFinish && !err) {
          err = new Error('sync stream terminated on remote side')
        }
        if (stream.goodFinish && err) err = undefined
        onClose(err)
      })
      connection.removeListener('close', onClose)
      connection.removeListener('error', onClose)
    }

    // Peers announce their device type, version, and name
    // When a user hits 'SYNC' on the client, then the client calls the replicate
    // function and accepts the handshake
    function onHandshake (req, accept) {
      debug('got handshake', info.host, info.port)

      // as soon as any data is received, accept! Because this means that
      // the other side just have accepted & wants to start.
      stream.once('accepted', function () {
        accept()
      })
      if (info.type === 'ws') {
        peer = self.state.addWebsocketPeer(connection, info)
      } else {
        peer = self.state.addWifiPeer(connection, info)
      }
      peer.handshake = { accept: accept }
      peer.deviceType = req.deviceType
      peer.name = req.deviceName
      self.emit('peer', peer)
    }
  }
}

function isGzipFile (filepath, cb) {
  fs.exists(filepath, function (exists) {
    if (!exists) return cb(null, false)
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
  if (typeof projectKey === 'string') {
    projectKey = Buffer.from(projectKey, 'hex')
  }
  if (Buffer.isBuffer(projectKey) && projectKey.length === 32) {
    return crypto.discoveryKey(projectKey).toString('hex')
  } else {
    throw new Error('projectKey must be undefined or a 32-byte Buffer, or a hex string encoding a 32-byte buffer')
  }
}

Sync.discoveryKey = discoveryKey

module.exports = Sync
