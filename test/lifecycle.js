var helpers = require('./helpers')
var test = require('tape')
var rimraf = require('rimraf')

function createApis (opts, cb) {
  if (!cb && typeof opts === 'function') {
    cb = opts
    opts = undefined
  }
  opts = opts || {}
  var api1 = helpers.createApi(null, opts.api1)
  var api2 = helpers.createApi(null, opts.api2)
  api1.on('error', console.error)
  api2.on('error', console.error)
  function close (cb) {
    cb = cb || function () {}
    var pending = 2
    function done () {
      if (!--pending) {
        rimraf(api1._dir, function () {
          rimraf(api2._dir, function () {
            cb()
          })
        })
      }
    }

    api1.close(done)
    api2.close(done)
  }
  api1.osm.ready(function () {
    api2.osm.ready(function () {
      cb(api1, api2, close)
    })
  })
}

test('should properly open and close', function (t) {
  var mapeo = helpers.createApi()
  mapeo.sync.listen(function () {
    mapeo.close(function () {
      t.end()
    })
  })
})

test('should properly close before reopening', function (t) {
  var mapeo = helpers.createApi()
  mapeo.sync.listen(function () {
    mapeo.close(function () {
      mapeo.sync.listen(function () {
        mapeo.close(() => {
          t.end()
        })
      })
    })
  })
})


test('should properly close during a sync', function (t) {
  var opts = {api1:{deviceType:'desktop'}, api2:{deviceType:'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var total = 50
    var pending = 3
    api2.sync.setName('device_2')

    api1.sync.listen()
    api1.sync.join()
    api1.sync.once('peer', written.bind(null, null))
    api2.sync.listen()
    api2.sync.join()
    api2.sync.once('peer', written.bind(null, null))
    helpers.writeBigData(api1, total, written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        var peers1 = api1.sync.peers()
        var peers2 = api2.sync.peers()
        if (peers1.length >= 1 && peers2.length >= 1) {
          sync(peers1[0])
        }
      }
    }

    function onerror (err) {
      t.ok(err)
      api1.close(function () {
        t.end()
      })
    }

    function sync (peer) {
      t.equals(peer.name, 'device_2')
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', onerror)
      syncer.on('end', () => {
        t.ok(true, 'replication complete')
      })
      syncer.once('progress', function (progress) {
        api2.close(() => {
        })
      })
    }
  })
})

