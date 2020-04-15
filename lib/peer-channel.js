const bsync = require('blob-store-replication-stream')
const handshake = require('handshake-stream')
const multiplex = require('multiplex')
const pump = require('pump')
const progressSync = require('./db-sync-progress')
const util = require('./util')
const MRPC = require('muxrpc')
const pull = require('pull-stream')
const toPull = require('stream-to-pull-stream')
const {EventEmitter} = require('events')

class PeerChannel extends EventEmitter {
  constructor (opts) {
    super()

    const self = this
    const db = opts.osm
    const media = opts.media
    const handshakePayload = opts.handshakePayload

    let remoteDeviceType
    const multistream = multiplex()

    // sync stream gets wrapped in a handshake-stream
    const hand = handshake(multistream, handshakePayload, (req, accept) => {
      if (req.protocolVersion === handshakePayload.protocolVersion) {
        remoteDeviceType = req.deviceType
        accept()
        this.emit('handshake-complete', req)
      } else {
        process.nextTick(function () {
          accept(new Error('Incompatible remote protocol version: ' + req.protocolVersion))
        })
      }
    })
    this.stream = hand

    function createMultifeedSyncStream (name) {
      const r = progressSync(opts.isInitiator, {osm: db}, {live: false})
      const p2p = multistream.createSharedStream('multifeed-' + name)
      pump(r, p2p, r)
      return r
    }

    function createBlobSyncStream (name) {
      const blobsync = bsync(media, { filter: mediaSyncFilter.bind(null, remoteDeviceType) })
      const p2p = multistream.createSharedStream('media-' + name)
      pump(blobsync, p2p, blobsync)
      return blobsync
    }

    // RPC instance & stream
    const rpcManifest = {
      sync: 'async',
      getMultifeedTotals: 'async'
    }
    const rpcApi = {
      // TODO: guard against race condition of both sides trying to start sync at the same time
      sync (cb) {
        const ev = new EventEmitter()
        self._sync(ev)
        self.emit('remote-sync', ev)
        cb()
      },
      getMultifeedTotals (cb) {
        cb(null, util.dbState(db))
      }
    }
    const rpc = MRPC(rpcManifest, rpcManifest)(rpcApi)
    const multiRpc = multistream.createSharedStream('rpc')
    const multiRpcPull = toPull.duplex(multiRpc)
    pull(multiRpcPull, rpc.createStream(), multiRpcPull)
    multiRpc.once('error', err => this.emit('error', err))

    this.sync = function (cb) {
      const ev = new EventEmitter()
      rpc.sync(err => {
        if (err) return ev.emit('error', err)
        self._sync(ev)
      })
      return ev
    }

    this._sync = function (ev) {
      const progress = {
        db: { sofar: 0, total: 0 },
        media: { sofar: 0, total: 0 }
      }
      const localDbState = util.dbState(db)
      let pending = 2

      rpc.getMultifeedTotals((err, remoteDbState) => {
        if (err) return onEnd(err)
        const expectedDownloads = util.getExpectedDownloadEvents(localDbState, remoteDbState)
        const expectedUploads = util.getExpectedUploadEvents(localDbState, remoteDbState)
        const mfSync = createMultifeedSyncStream('0')
        mfSync.on('progress', (sofar, total) => {
          progress.db.sofar = sofar
          progress.db.total = total
          ev.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
        })
        mfSync.once('end', onEnd)
        mfSync.once('error', onEnd)
        mfSync.setTotals(expectedDownloads, expectedUploads)
      })

      const blobSync = createBlobSyncStream('0')
      blobSync.on('progress', (sofar, total) => {
        progress.media.sofar = sofar
        progress.media.total = total
        ev.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
      })
      blobSync.once('finish', onEnd)
      blobSync.once('error', onEnd)

      function onEnd (err) {
        if (err) {
          pending = Infinity
          ev.emit('error', err)
          return
        }
        if (--pending) return
        ev.emit('end')
      }

      return ev
    }

    // pump protocol stream and remote connection together
    pump(hand, opts.connection, hand, err => {
      if (err) return this.emit('error', err)
      else this.emit('end')
    })
  }
}

function mediaSyncFilter (remoteDeviceType, filename) {
  if (filename.startsWith('original/') && remoteDeviceType === 'mobile') return false
  else return true
}

module.exports = PeerChannel
