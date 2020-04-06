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

    function onStreamError (err) {
      // TODO: emit on hand or this?
      hand.emit('error', err)
    }

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
      createMultifeedSyncStream: 'async',
      createBlobSyncStream: 'async',
      getMultifeedTotals: 'async'
    }
    const rpcApi = {
      createMultifeedSyncStream (name, remoteDbState, cb) {
        const localDbState = util.dbState(db)
        const sync = createMultifeedSyncStream(name)

        rpc.getMultifeedTotals((err, remoteDbState) => {
          if (err) return onStreamError(err)
          const expectedDownloads = util.getExpectedDownloadEvents(localDbState, remoteDbState)
          const expectedUploads = util.getExpectedUploadEvents(localDbState, remoteDbState)
          sync.setTotals(expectedDownloads, expectedUploads)
        })

        cb(null, { accept: true, state: localDbState })
      },
      getMultifeedTotals (cb) {
        cb(null, util.dbState(db))
      },
      createBlobSyncStream (name, cb) {
        createBlobSyncStream(name)
        cb(null, true)
      }
    }
    const rpc = MRPC(rpcManifest, rpcManifest)(rpcApi)
    const multiRpc = multistream.createSharedStream('rpc')
    const multiRpcPull = toPull.duplex(multiRpc)
    pull(multiRpcPull, rpc.createStream(), multiRpcPull)

    this.sync = function () {
      const progress = {
        db: { sofar: 0, total: 0 },
        media: { sofar: 0, total: 0 }
      }
      const ev = new EventEmitter()
      const localDbState = util.dbState(db)
      let pendingStreamEnds = 2

      rpc.createMultifeedSyncStream('0', localDbState, (err, res) => {
        if (err) return onError(err)

        const mfSync = createMultifeedSyncStream('0')
        mfSync.on('progress', (sofar, total) => {
          progress.db.sofar = sofar
          progress.db.total = total
          ev.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
        })
        mfSync.once('end', onEnd)
        mfSync.once('error', onEnd)

        rpc.getMultifeedTotals((err, remoteDbState) => {
          if (err) return onError(err)
          const expectedDownloads = util.getExpectedDownloadEvents(localDbState, remoteDbState)
          const expectedUploads = util.getExpectedUploadEvents(localDbState, remoteDbState)
          mfSync.setTotals(expectedDownloads, expectedUploads)
        })
      })

      rpc.createBlobSyncStream('0', (err, accept) => {
        if (err) return onError(err)

        const blobSync = createBlobSyncStream('0')
        blobSync.on('progress', (sofar, total) => {
          progress.media.sofar = sofar
          progress.media.total = total
          ev.emit('progress', { db: Object.assign({}, progress.db), media: Object.assign({}, progress.media) })
        })
        blobSync.once('finish', onEnd)
        blobSync.once('error', onEnd)
      })

      function onError (err) {
        ev.emit('error', err)
      }

      function onEnd (err) {
        if (err) {
          pendingStreamEnds = Infinity
          onEnd(err)
          return
        }
        if (--pendingStreamEnds) return
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
