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
    let currentMfStream, currentBlobStream

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
      r.start = function () { pump(r, p2p, r) }
      return r
    }

    function createBlobSyncStream (name) {
      const r = bsync(media, { filter: mediaSyncFilter.bind(null, remoteDeviceType) })
      const p2p = multistream.createSharedStream('media-' + name)
      r.start = function () { pump(r, p2p, r) }
      return r
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
        currentMfStream = createMultifeedSyncStream('0')
        currentBlobStream = createBlobSyncStream('0')
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
    const rpcStream = rpc.createStream()
    // TODO: how to catch pull stream errors?
    pull(multiRpcPull, rpcStream, multiRpcPull)

    this.sync = function (cb) {
      const ev = new EventEmitter()
      rpc.sync(err => {
        if (err) return ev.emit('error', err)
        currentMfStream = createMultifeedSyncStream('0')
        currentBlobStream = createBlobSyncStream('0')
        self._sync(ev)
      })
      return ev
    }

    this._sync = function (ev) {
      self.once('error', onEnd2)
      self.once('end', onEnd2)

      const progress = {
        db: { sofar: 0, total: 0 },
        media: { sofar: 0, total: 0 }
      }
      const localDbState = util.dbState(db)

      const mfSync = currentMfStream
      mfSync.on('progress', (sofar, total) => {
        progress.db.sofar = sofar
        progress.db.total = total
        ev.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
      })
      mfSync.once('end', onEnd1)
      mfSync.once('error', onEnd1)
      rpc.getMultifeedTotals((err, remoteDbState) => {
        if (err) return onEnd1(err)
        const expectedDownloads = util.getExpectedDownloadEvents(localDbState, remoteDbState)
        const expectedUploads = util.getExpectedUploadEvents(localDbState, remoteDbState)
        mfSync.setTotals(expectedDownloads, expectedUploads)
        mfSync.start()
      })

      function onEnd1 (err) {
        if (err) {
          ev.emit('error', err)
          return
        }
        const blobSync = currentBlobStream
        blobSync.on('progress', (sofar, total) => {
          progress.media.sofar = sofar
          progress.media.total = total
          ev.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
        })
        blobSync.once('finish', onEnd2)
        blobSync.once('error', onEnd2)
        blobSync.start()
      }

      function onEnd2 (err) {
        self.removeListener('error', onEnd2)
        self.removeListener('end', onEnd2)
        if (err) ev.emit('error', err)
        else ev.emit('end')
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
