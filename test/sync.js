var path = require('path')
var os = require('os')
var tape = require('tape')
var rimraf = require('rimraf')
var itar = require('indexed-tarball')
var crypto = require('crypto')
var tmp = require('tmp')
var MapeoWeb = require('mapeo-web')
var MapeoWebClient = require('mapeo-web/client')
var pino = require('pino')
var getPort = require('get-port')
var discoveryKey = require('../sync').discoveryKey

var helpers = require('./helpers')

function createWeb () {
  var storageLocation = tmp.dirSync().name

  return MapeoWeb.create({
    storageLocation: storageLocation,
    logger: pino({level: 'silent'})
  })
}

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
        api1.osm.close(function () {
          api2.osm.close(function () {
            rimraf(api1._dir, function () {
              rimraf(api2._dir, function () {
                cb()
              })
            })
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

tape('sync with mapeo-web server', function (t) {
  const projectKey = crypto.randomBytes(32)
  const mapeo = helpers.createApi(null, {
    encryptionKey: projectKey
  })

  const mapeoWeb = createWeb()

  mapeo.osm.ready(() => {
    listen((e, port) => {
      t.error(e, 'able to listen')
      putProject(port, (e) => {
        t.error(e, 'added project')
        writeOSM((e, id) => {
          mapeo.sync.once('peer', (peer) => verifyPeer(peer, id, port))
          t.error(e, 'initialized OSM data')
          writeMedia((e) => {
            t.error(e, 'initialized media')
            replicate(port)
          })
        })
      })
    })
  })

  function verifyPeer (peer, osmId, port) {
    t.pass('Got peer')
    const sync = mapeo.sync.replicate(peer)
    sync.on('end', () => {
      t.pass('Finished sync')
      verifyData(osmId, () => {
        listAndRemove(port, finishUp)
      })
    })
  }

  function listAndRemove (port, cb) {
    const keyString = projectKey.toString('hex')
    const url = `http://localhost:${port}`

    MapeoWebClient.list({ url }).then(async (keys) => {
      t.deepEqual(keys, [{ discoveryKey: discoveryKey(keyString) }], 'Project in list on server')

      await MapeoWebClient.remove({ url, projectKey })

      const finalKeys = await MapeoWebClient.list({ url })

      t.deepEqual(finalKeys, [], 'Project removed from server')

      cb(null)
    }).catch(cb)
  }

  function verifyData (osmId, cb) {
    const local = mapeoWeb.get(projectKey)

    local.osm.get(osmId, (e, node) => {
      t.error(e, 'No erorr getting OSM')
      t.ok(node, 'OSM node exists')
      local.media.exists('foo.txt', (err, exists) => {
        t.error(err, 'No error reading file')
        t.ok(exists, 'File exists')
        cb()
      })
    })
  }

  function finishUp (err) {
    if (err) t.error(err)
    mapeoWeb.close((err) => {
      t.error(err, 'Closed with no errors')
      t.end()
    })
  }

  function replicate (port) {
    const url = `ws://localhost:${port}/`
    mapeo.sync.connectWebsocket(url, projectKey)
  }

  function writeMedia (cb) {
    const ws = mapeo.media.createWriteStream('foo.txt')
    ws.on('finish', cb)
    ws.on('error', cb)
    ws.end('bar')
  }

  function writeOSM (cb) {
    const observation = { lat: 1, lon: 2, type: 'observation' }
    mapeo.osm.create(observation, cb)
  }

  function putProject (port, cb) {
    const keyString = projectKey.toString('hex')
    const url = `http://localhost:${port}`

    MapeoWebClient.add({ url, projectKey: keyString }).then(async (res) => {
      const { id } = res
      t.ok(id, 'Got discoveryKey from add')
      cb(null)
    }).catch(cb)
  }

  function listen (cb) {
    getPort().then((port) => {
      mapeoWeb.listen(port, () => cb(null, port))
    }).catch(cb)
  }
})

tape('sync: trying to sync to unknown peer', function (t) {
  var api1 = helpers.createApi(null)
  function done () {
    api1.close()
    t.end()
  }

  api1.sync.listen(() => {
    api1.sync.join()
    var emitter = api1.sync.replicate({host: 'not a thing', port: 1337})
    emitter.on('error', (err) => {
      t.ok(err)
      done()
    })
  })
})

tape('sync: leave even if swarm is undefined', function (t) {
  var api1 = helpers.createApi(null)
  api1.sync.leave()
  api1.close()
  t.end()
})

tape('sync: two servers find each other with default sync key', function (t) {
  t.plan(3)

  createApis(function (api1, api2, close) {
    var pending = 2

    function done () {
      if (--pending) return
      close(() => {
        t.pass('close ok')
      })
    }

    api1.sync.listen(function () {
      api2.sync.listen(function () {
        api1.sync.once('peer', function (peer) {
          var peerId = peer.id.toString('hex')
          t.same(peerId, api2.sync.swarm.id.toString('hex'), 'api2 id cmp')
          done()
        })
        api2.sync.once('peer', function (peer) {
          var peerId = peer.id.toString('hex')
          t.same(peerId, api1.sync.swarm.id.toString('hex'), 'api1 id cmp')
          done()
        })
        api1.sync.join()
        api2.sync.join()
      })
    })
  })
})

tape('sync: two servers find each other with same projectKey', function (t) {
  t.plan(3)

  createApis(function (api1, api2, close) {
    var pending = 2

    function done () {
      if (--pending) return
      close(() => {
        t.pass('close ok')
      })
    }

    const projectKey = crypto.randomBytes(32)

    api1.sync.listen(function () {
      api2.sync.listen(function () {
        api1.sync.once('peer', function (peer) {
          var peerId = peer.id.toString('hex')
          t.same(peerId, api2.sync.swarm.id.toString('hex'), 'api2 id cmp')
          done()
        })
        api2.sync.once('peer', function (peer) {
          var peerId = peer.id.toString('hex')
          t.same(peerId, api1.sync.swarm.id.toString('hex'), 'api1 id cmp')
          done()
        })
        api1.sync.join(projectKey)
        api2.sync.join(projectKey)
      })
    })
  })
})

tape('sync: two servers with different projectKey don\'t find each other', function (t) {
  t.plan(3)

  createApis(function (api1, api2, close) {
    setTimeout(() => {
      t.equal(api1.sync.peers().length, 0, 'api1 has found no peers')
      t.equal(api2.sync.peers().length, 0, 'api2 has found no peers')
      close(() => {
        t.pass('close ok')
      })
    }, 5000)

    api1.sync.listen(function () {
      api2.sync.listen(function () {
        api1.sync.once('peer', function (peer) {
          t.fail('Should not find peer')
          console.log(loggablePeer(peer))
        })
        api2.sync.once('peer', function (peer) {
          t.fail('Should not find peer')
          console.log(loggablePeer(peer))
        })
        api1.sync.join(crypto.randomBytes(32))
        api2.sync.join(crypto.randomBytes(32))
      })
    })
  })
})

tape('sync: trying to sync with an invalid projectKey throws', function (t) {
  t.plan(2)

  createApis(function (api1, api2, close) {
    api1.sync.listen(function () {
      api2.sync.listen(function () {
        t.throws(() => api1.sync.join('invalid key'), 'throws on invalid key')
        close(() => {
          t.pass('close ok')
        })
      })
    })
  })
})

tape('sync: remote peer error/destroyed is reflected in peer state', function (t) {
  t.plan(4)

  createApis(function (api1, api2, close) {
    var pending = 2

    function done () {
      if (--pending === 0) return

      api1.sync.once('down', function () {
        var peers = api1.sync.peers()
        t.same(peers.length, 1)
        close(() => {
          t.pass('close ok')
        })
      })

      setTimeout(() => {
        api2.close()
      }, 1000)
    }

    api1.sync.listen(function () {
      api2.sync.listen(function () {
        function check (api) {
          return (peer) => {
            var peerId = peer.id.toString('hex')
            t.same(peerId, api.sync.swarm.id.toString('hex'), 'api2 id cmp')
            done()
          }
        }
        api1.sync.once('peer', check(api2))
        api2.sync.once('peer', check(api1))
        api1.sync.join()
        api2.sync.join()
      })
    })
  })
})

tape('sync: replication of a simple observation with media', function (t) {
  t.plan(15)

  createApis(function (api1, api2, close) {
    var obs = {lat: 1, lon: 2, type: 'observation'}
    var ws = api1.media.createWriteStream('foo.txt')
    var pending = 3
    ws.on('finish', written)
    ws.on('error', written)
    ws.end('bar')

    api1.sync.once('peer', written.bind(null, null))
    api2.sync.once('peer', written.bind(null, null))
    api1.sync.listen(() => {
      api1.sync.join()
    })
    api2.sync.listen(() => {
      api2.sync.join()
    })

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        api1.osm.create(obs, function (err, _id, node) {
          t.error(err, 'obs1 created')
          id = _id
          t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
          t.ok(api2.sync.peers().length > 0, 'api 2 has peers')
          if (api1.sync.peers().length >= 1) {
            var peer = api1.sync.peers()[0]
            sync(peer)
          }
        })
      }
    }

    var id = null

    function sync (peer) {
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close(() => {
          t.fail()
        })
      })
      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        api1.osm.get(id, function (err, node) {
          t.error(err)
          api2.osm.get(id, function (err, _node) {
            t.error(err)
            t.same(node, _node, 'node replicated successfully')
            api2.media.exists('foo.txt', function (err, exists) {
              t.error(err)
              t.ok(exists)
              t.same(peer.state.topic, 'replication-complete')
              const date = new Date(peer.state.message)
              t.ok(date.getTime() <= new Date().getTime(), 'last completed date')
              close(function () {
                t.pass('close ok')
              })
            })
          })
        })
      })
    }
  })
})

tape('bad sync: syncfile replication: osm-p2p-syncfile', function (t) {
  t.plan(3)

  var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
  var syncfile = new itar(tmpfile)
  syncfile.userdata({ syncfile: { 'p2p-db': 'hyperlog' } }, start)

  function start () {
    createApis({api1: {writeFormat: 'osm-p2p-syncfile'}}, function (api1, api2, close) {
      api1.sync.replicate({filename: tmpfile})
        .once('end', function () {
          t.fail()
        })
        .once('error', function (err) {
          t.ok(err)
          t.same(err.message, 'trying to sync this kappa-osm database with a hyperlog database!')
          close(() => {
            t.pass('close ok')
          })
        })
        .on('progress', function (progress) {
          close(() => {
            t.fail()
          })
        })
    })
  }
})

tape('sync: syncfile replication: osm-p2p-syncfile', function (t) {
  createApis({api1: {writeFormat: 'osm-p2p-syncfile'}}, function (api1, api2, close) {
    // create test data
    var id
    var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
    var pending = 2
    var lastProgress
    var obs = {lat: 1, lon: 2, type: 'observation'}

    api1.osm.create(obs, written)
    var ws = api1.media.createWriteStream('foo.txt')
    ws.once('finish', written)
    ws.once('error', written)
    ws.end('bar')

    function written (err, res) {
      t.error(err, res ? 'osm data written ok' : 'media data written ok')
      if (res) id = res.id
      if (--pending === 0) {
        api1.sync.replicate({filename: tmpfile})
          .once('end', syncfileWritten)
          .once('error', syncfileWritten)
          .on('progress', function (progress) {
            lastProgress = progress
          })
      }
    }

    function syncfileWritten (err) {
      t.error(err, 'first syncfile written ok')
      delete lastProgress.timestamp
      t.deepEquals(lastProgress, {
        db: { sofar: 1, total: 1 },
        media: { sofar: 1, total: 1 }
      }, 'first progress state ok')

      api2.sync.replicate({filename: tmpfile})
        .once('end', secondSyncfileWritten)
        .once('error', secondSyncfileWritten)
        .on('progress', function (progress) {
          lastProgress = progress
        })
    }

    function secondSyncfileWritten (err) {
      t.error(err, 'second syncfile written ok')
      delete lastProgress.timestamp
      t.deepEquals(lastProgress, {
        db: { sofar: 1, total: 1 },
        media: { sofar: 1, total: 1 }
      }, 'second progress state ok')

      api2.osm.get(id, function (err, heads) {
        t.error(err)
        t.equals(Object.keys(heads).length, 1, 'one osm head')
        var res = heads[Object.keys(heads)[0]]
        t.same(res.id, id)
        t.same(res.lat, obs.lat)
        t.same(res.lon, obs.lon)
        api2.media.createReadStream('foo.txt')
          .on('data', function (buf) {
            t.equals(buf.toString(), 'bar')
            close(() => {
              t.end()
            })
          })
      })
    }
  })
})

tape('sync: try to sync two different projectKey syncfiles together', function (t) {
  t.plan(3)

  var key1 = crypto.randomBytes(32).toString('hex')
  var key2 = crypto.randomBytes(32).toString('hex')

  var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
  var syncfile = new itar(tmpfile)
  syncfile.userdata({syncfile: { 'p2p-db': 'kappa-osm', discoveryKey: key1} }, start)

  function start () {
    createApis({api1: {writeFormat: 'osm-p2p-syncfile'}}, function (api1, api2, close) {
      api1.sync.replicate({filename: tmpfile}, {projectKey: key2})
        .once('end', function () {
          close(() => {
            t.fail()
          })
        })
        .once('error', function (err) {
          t.ok(err)
          t.ok(/trying to sync two different projects/.test(err.message), 'expected error message')
          close(() => {
            t.pass('close ok')
          })
        })
        .on('progress', function (progress) {
          close(() => {
            t.fail()
          })
        })
    })
  }
})

tape('sync: syncfile /wo projectKey, api with projectKey set', function (t) {
  createApis({api1: {writeFormat: 'osm-p2p-syncfile'}}, function (api1, api2, close) {
    // create test data
    var id
    var tmpfile = path.join(os.tmpdir(), 'sync1-' + Math.random().toString().substring(2))
    var pending = 2
    var lastProgress
    var obs = {lat: 1, lon: 2, type: 'observation'}
    var projectKey = crypto.randomBytes(32).toString('hex')

    api1.osm.create(obs, written)
    var ws = api1.media.createWriteStream('foo.txt')
    ws.once('finish', written)
    ws.once('error', written)
    ws.end('bar')

    function written (err, res) {
      t.error(err, res ? 'osm data written ok' : 'media data written ok')
      if (res) id = res.id
      if (--pending === 0) {
        api1.sync.replicate({filename: tmpfile})
          .once('end', syncfileWritten)
          .once('error', syncfileWritten)
          .on('progress', function (progress) {
            lastProgress = progress
          })
      }
    }

    function syncfileWritten (err) {
      t.error(err, 'first syncfile written ok')
      delete lastProgress.timestamp
      t.deepEquals(lastProgress, {
        db: { sofar: 1, total: 1 },
        media: { sofar: 1, total: 1 }
      }, 'first progress state ok')

      api2.sync.replicate({filename: tmpfile})
        .once('end', secondSyncfileWritten)
        .once('error', secondSyncfileWritten)
        .on('progress', function (progress) {
          lastProgress = progress
        })
    }

    function secondSyncfileWritten (err) {
      t.error(err, 'second syncfile written ok')
      delete lastProgress.timestamp
      t.deepEquals(lastProgress, {
        db: { sofar: 1, total: 1 },
        media: { sofar: 1, total: 1 }
      }, 'second progress state ok')

      api2.osm.get(id, function (err, heads) {
        t.error(err)
        t.equals(Object.keys(heads).length, 1, 'one osm head')
        var res = heads[Object.keys(heads)[0]]
        t.same(res.id, id)
        t.same(res.lat, obs.lat)
        t.same(res.lon, obs.lon)
        api2.media.createReadStream('foo.txt')
          .on('data', function (buf) {
            t.equals(buf.toString(), 'bar')
            close(() => {
              t.end()
            })
          })
      })
    }
  })
})

tape('sync: desktop <-> desktop photos', function (t) {
  t.plan(14)

  var opts = {api1: {deviceType: 'desktop'}, api2: {deviceType: 'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 5
    var lastProgress

    api2.sync.setName('device_2')

    api1.sync.once('peer', written.bind(null, null))
    api2.sync.once('peer', written.bind(null, null))
    api1.sync.listen(() => {
      api1.sync.join()
    })
    api2.sync.listen(() => {
      api2.sync.join()
    })
    helpers.writeBigData(api1, total, written)
    writeBlob(api2, 'goodbye_world.png', written)

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

    function sync (peer) {
      t.equals(peer.name, 'device_2')
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close(() => {
          t.fail()
        })
      })

      syncer.once('progress', function (progress) {
        lastProgress = progress
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        delete lastProgress.timestamp
        t.deepEquals(lastProgress, {
          db: { sofar: 5, total: 5 },
          media: { sofar: 18, total: 18 }
        }, 'progress state ok')

        var peers1 = api1.sync.peers()
        var peers2 = api2.sync.peers()
        t.same(peers1[0].state.topic, 'replication-complete')
        setTimeout(function () {
          t.same(peers2[0].state.topic, 'replication-complete')
        }, 2000)
        var pending = 2
        var expected = mockExpectedMedia(total)
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        api1.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort(), 'api1 has the files')
          if (!--pending) close(() => t.pass('close ok'))
        })
        api2.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort(), 'api2 has the files')
          if (!--pending) close(() => t.pass('close ok'))
        })
      })
    }
  })
})

tape('sync: deletes are not synced back', function (t) {
  t.plan(18)

  var deleted

  var opts = {api1: {deviceType: 'desktop'}, api2: {deviceType: 'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 5
    var lastProgress

    api2.sync.setName('device_2')

    api1.sync.once('peer', written.bind(null, null))
    api2.sync.once('peer', written.bind(null, null))
    api1.sync.listen(() => {
      api1.sync.join()
    })
    api2.sync.listen(() => {
      api2.sync.join()
    })
    helpers.writeBigData(api1, total, written) // write 5 entries
    writeBlob(api2, 'goodbye_world.png', written)

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

    function deleteObs () {
      api1.sync.once('peer', (peer) => {
        api2.observationList(function (err, results2) {
          t.error(err)
          api1.observationList(function (err, results) {
            t.error(err)
            t.same(results2, results)
            deleted = results[0]
            api1.observationDelete(deleted.id, (err) => {
              t.error(err)
              var syncer = api1.sync.replicate(peer)
              syncer.once('error', (err) => t.error(err))
              syncer.once('end', () => {
                // XXX: race condition where the indexers haven't warmed back
                // up after syncing yet, but an API request is being made on
                // the view immediately, resulting in stale data being given
                // back (unless we wait for a bit)
                setTimeout(() => {
                  api2.observationList(function (err, after) {
                    t.error(err)
                    t.same(after.length, results.length - 1, 'one less item in list')
                    close(() => t.pass('close ok'))
                  })
                }, 100)
              })
            })
          })
        })
      })
    }

    function sync (peer) {
      t.equals(peer.name, 'device_2')
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close(() => {
          t.fail()
        })
      })

      syncer.once('progress', function (progress) {
        lastProgress = progress
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        delete lastProgress.timestamp
        t.deepEquals(lastProgress, {
          db: { sofar: 5, total: 5 },
          media: { sofar: 18, total: 18 }
        }, 'progress state ok')

        var pending = 2
        var expected = mockExpectedMedia(total)
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        api1.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort(), 'api1 has the files')
          if (!--pending) deleteObs()
        })
        api2.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected.sort(), 'api2 has the files')
          if (!--pending) deleteObs()
        })
      })
    }
  })
})

tape('sync: mobile <-> desktop photos', function (t) {
  t.plan(12)

  var opts = {
    api1: { deviceType: 'mobile' },
    api2: { deviceType: 'desktop' }
  }
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 5
    var mobile = api1
    var desktop = api2

    api1.sync.once('peer', written.bind(null, null))
    api2.sync.once('peer', written.bind(null, null))
    api1.sync.listen(() => {
      api1.sync.join()
    })
    api2.sync.listen(() => {
      api2.sync.join()
    })
    helpers.writeBigData(mobile, total, written)
    writeBlob(desktop, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(mobile.sync.peers().length > 0, 'api 1 has peers')
        t.ok(desktop.sync.peers().length > 0, 'api 2 has peers')
        if (mobile.sync.peers().length >= 1) {
          sync(mobile.sync.peers()[0])
        }
      }
    }

    function sync (peer) {
      var syncer = mobile.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close(() => {
          t.fail()
        })
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var pending = 2
        var expectedMobile = mockExpectedMedia(total)
          .concat([
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        var expectedDesktop = mockExpectedMedia(total)
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        mobile.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expectedMobile.sort())
          if (!--pending) close(() => t.pass('close ok'))
        })
        desktop.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expectedDesktop.sort())
          if (!--pending) close(() => t.pass('close ok'))
        })
      })
    }
  })
})

tape('sync: mobile <-> mobile photos', function (t) {
  t.plan(12)

  var opts = {api1: {deviceType: 'mobile'}, api2: {deviceType: 'mobile'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 5

    var clone = api2

    api1.sync.once('peer', written.bind(null, null))
    api2.sync.once('peer', written.bind(null, null))
    api1.sync.listen(() => {
      api1.sync.join()
    })
    api2.sync.listen(() => {
      api2.sync.join()
    })
    helpers.writeBigData(api1, total, written)
    writeBlob(clone, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
        t.ok(clone.sync.peers().length > 0, 'api 2 has peers')
        if (api1.sync.peers().length >= 1) {
          sync(api1.sync.peers()[0])
        }
      }
    }

    function sync (peer) {
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close(() => {
          t.fail()
        })
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var pending = 2
        var expected1 = mockExpectedMedia(total).concat([
          'preview/goodbye_world.png',
          'thumbnail/goodbye_world.png'
        ])
        var expectedClone = mockExpectedMedia(total)
          .filter((m) => !m.startsWith('original/'))
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        api1.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expected1.sort())
          if (!--pending) close(() => t.pass('close ok'))
        })
        clone.media.list(function (err, files) {
          t.error(err)
          t.deepEquals(files.sort(), expectedClone.sort())
          if (!--pending) close(() => t.pass('close ok'))
        })
      })
    }
  })
})

tape('sync: with two peers available, sync with one only triggers events for one sync', function (t) {
  var opts = {api1: {name: 'boop', deviceType: 'desktop'}, api2: {name: 'beep', deviceType: 'desktop'}}
  createApis(opts, function (api1, api2, close1) {
    var opts = {api1: {name: 'bork', deviceType: 'mobile'}, api2: {name: 'baz', deviceType: 'mobile'}}
    createApis(opts, function (api3, api4, close2) {
      var pending = 6
      var total = 20

      function doListen (api, cb) {
        api.sync.listen(() => {
          let pending = 3
          api.once('error', console.error)
          api.sync.on('peer', () => { if (!--pending) cb() })
          api.sync.join()
        })
      }

      var target

      helpers.writeBigData(api1, total, written)
      writeBlob(api2, 'goodbye_world.png', written)

      doListen(api1, written)
      doListen(api2, written)
      doListen(api3, written)
      doListen(api4, written)

      function written (err) {
        t.error(err)
        if (--pending === 0) {
          t.same(api1.sync.peers().length, 3, 'api 1 has 3 peers')
          t.same(api2.sync.peers().length, 3, 'api 2 has 3 peers')
          t.same(api3.sync.peers().length, 3, 'api 3 has 3 peers')
          t.same(api4.sync.peers().length, 3, 'api 4 has 3 peers')
          target = api1.sync.peers()[0]
          sync(target)
        }
      }

      function sync (peer) {
        var syncer = api1.sync.replicate(peer)
        syncer.on('error', t.error)
        syncer.on('end', function () {
          setTimeout(function () {
            var peers = api1.sync.peers()
            peers.forEach((p) => {
              if (p === peer) t.same(p.state.topic, 'replication-complete')
              else t.same(p.state.topic, 'replication-wifi-ready')
            })
            close1()
            close2()
            t.end()
          }, 2000)
        })

        var totalProgressEvents = 0
        syncer.on('progress', function (progress) {
          var peers = api1.sync.peers()
          t.same(peers.length, 3, 'three peers')
          if (totalProgressEvents > 1) {
            peers.forEach((p) => {
              if (p.name === target.name) t.same(p.state.topic, 'replication-progress', 'target has progress event')
              else t.same(p.state.topic, 'replication-wifi-ready')
            })
          }
          totalProgressEvents += 1
        })
      }
    })
  })
})

tape('sync: destroy during sync is reflected in peer state', function (t) {
  t.plan(11)

  var opts = {api1: {deviceType: 'desktop'}, api2: {deviceType: 'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 20

    api1.sync.once('peer', written.bind(null, null))
    api2.sync.once('peer', written.bind(null, null))
    api1.sync.listen(() => {
      api1.sync.join()
    })
    api2.sync.listen(() => {
      api2.sync.join()
    })
    helpers.writeBigData(api1, total, written)
    writeBlob(api2, 'goodbye_world.png', written)

    api1.on('error', console.error)
    api2.on('error', console.error)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
        t.ok(api2.sync.peers().length > 0, 'api 2 has peers')
        if (api1.sync.peers().length >= 1) {
          sync(api1.sync.peers()[0])
        }
      }
    }

    function sync (peer) {
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.ok(err)
        var peers = api1.sync.peers()
        t.same(peers.length, 1, 'one peer on error')
        t.same(peers[0].state.topic, 'replication-error', 'replication error!')
        t.same(peers[0].state.message, err.toString(), 'got message')
        close(function () {
          t.pass('close ok')
        })
      })

      var totalProgressEvents = 0
      syncer.on('progress', function (progress) {
        totalProgressEvents += 1
        if (totalProgressEvents > 5) api2.sync.close()
      })
    }
  })
})

tape('sync: peer.connected property', function (t) {
  t.plan(13)

  var opts = {api1: {deviceType: 'desktop'}, api2: {deviceType: 'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 5
    var lastProgress

    api1.sync.once('peer', ready.bind(null, null))
    api2.sync.once('peer', ready.bind(null, null))
    helpers.writeBigData(api1, total, ready)
    writeBlob(api2, 'goodbye_world.png', ready)

    api1.sync.listen(() => api1.sync.join())
    api2.sync.listen(() => api2.sync.join())

    function ready (err) {
      t.error(err)
      if (--pending === 0) {
        t.same(1, api1.sync.peers().length, 'api1 has 1 peer')
        t.same(1, api2.sync.peers().length, 'api2 has 1 peer')
        t.ok(api1.sync.peers()[0].connected, 'peer1 is connected')
        t.ok(api2.sync.peers()[0].connected, 'peer2 is connected')
        sync(api1.sync.peers()[0])
      }
    }

    function sync (peer) {
      var syncer = api1.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err, 'sync error')
        close(() => t.fail('close ok'))
      })

      syncer.on('end', function () {
        t.pass('replication complete')
        t.notOk(peer.connected, 'peer is disconnected')
        api1.sync.once('peer', peer1 => {
          t.deepEquals(peer, peer1, 'old peer & new peer are the same object')
          t.ok(peer.connected, 'peer is reconnected')
          close(() => t.pass('close ok'))
        })
      })
    }
  })
})

tape('sync: peer.connected property on graceful exit', function (t) {
  t.plan(10)

  var opts = {api1: {deviceType: 'desktop'}, api2: {deviceType: 'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 2

    api1.sync.once('peer', ready.bind(null, null))
    api2.sync.once('peer', ready.bind(null, null))

    api1.sync.listen(() => api1.sync.join())
    api2.sync.listen(() => api2.sync.join())

    function ready (err) {
      t.error(err)
      if (--pending === 0) {
        t.same(1, api1.sync.peers().length, 'api1 has 1 peer')
        t.same(1, api2.sync.peers().length, 'api2 has 1 peer')
        t.ok(api1.sync.peers()[0].connected, 'peer1 is connected')
        t.ok(api2.sync.peers()[0].connected, 'peer2 is connected')
        quit(api1.sync.peers()[0])
      }
    }

    function quit (peer) {
      api1.sync.on('down', (peer) => {
        t.notOk(peer.connected, 'api1 emitted down event on api2 close')
        close(() => t.pass('close ok'))
      })

      api2.close(function () {
        t.same(1, api1.sync.peers().length, 'api1 has 1 peer')
        t.notOk(api1.sync.peers()[0].connected, 'peer shows disconected')
      })
    }
  })
})

tape('sync: missing data still ends', function (t) {
  t.plan(19)
  var opts = {api1: {deviceType: 'desktop'}, api2: {deviceType: 'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var restarted = false
    var _api1 = null

    let numSyncs = 0

    api1.sync.once('peer', written.bind(null, null))
    api2.sync.once('peer', written.bind(null, null))
    api1.sync.listen(() => {
      api1.sync.join()
    })
    api2.sync.listen(() => {
      api2.sync.join()
    })
    helpers.writeBigData(api1, 50, written)
    helpers.writeBigDataNoPhotos(api2, 450, written)

    function written (err) {
      t.error(err, 'written no error')
      if (--pending === 0) {
        t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
        t.ok(api2.sync.peers().length > 0, 'api 2 has peers')
        if (api2.sync.peers().length >= 1) {
          sync(api2.sync.peers()[0])
        }
      }
    }

    function restart () {
      api1.sync.leave()
      api1.close((err) => {
        api1.osm.close(() => {
          t.error(err, 'closed first api')
          _api1 = helpers.createApi(api1._dir)
          helpers.writeBigDataNoPhotos(_api1, 200, () => {
            _api1.sync.listen(() => {
              api2.sync.once('peer', (peer) => {
                sync(peer)
              })
              _api1.sync.join()
            })
          })
        })
      })
    }

    function done () {
      _api1.close(() => {
        _api1.osm.close(() => {
          api2.close(() => {
            t.end()
          })
        })
      })
    }

    function sync (peer, cb) {
      if (!cb) cb = () => {}
      t.ok(peer, 'syncronizing ' + numSyncs)
      numSyncs++
      api2.sync.once('down', (downPeer) => {
        t.pass('emit down event on close')
        t.notOk(downPeer.connected, 'not connected anymore')
        if (numSyncs === 2) {
          // SYNC AGAIN!
          api2.sync.once('peer', (_peer) => {
            if (peer.id === _peer.id) sync(_peer, done)
          })
        }
        cb()
      })
      var syncer = api2.sync.replicate(peer)
      syncer.on('error', function (err) {
        if (numSyncs === 1) t.ok(err, 'error on first ok')
        else if (numSyncs === 2) t.same(err.message, 'timed out due to missing data', 'error message for missing data')
      })

      syncer.on('progress', function (progress) {
        if (numSyncs === 1 && progress.db.sofar > 450 && progress.db.sofar < 455 && !restarted) {
          t.ok(peer.started, 'started is true')
          restart()
          restarted = true
        }
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
      })
    }
  })
})

tape('sync: 200 photos & close/reopen real-world scenario', function (t) {
  t.plan(18)
  var opts = {api1: {deviceType: 'desktop'}, api2: {deviceType: 'desktop'}}
  createApis(opts, function (api1, api2, close) {
    var pending = 4
    var total = 200
    var _api1 = null

    api1.sync.once('peer', written.bind(null, null))
    api2.sync.once('peer', written.bind(null, null))
    api1.sync.listen(() => {
      api1.sync.join()
    })
    api2.sync.listen(() => {
      api2.sync.join()
    })
    helpers.writeBigData(api1, total, written)
    writeBlob(api2, 'goodbye_world.png', written)

    function written (err) {
      t.error(err)
      if (--pending === 0) {
        t.ok(api1.sync.peers().length > 0, 'api 1 has peers')
        t.ok(api2.sync.peers().length > 0, 'api 2 has peers')
        if (api1.sync.peers().length >= 1) {
          // TEST: close one side and then re-open it before syncing
          api1.sync.leave()
          api1.close(() => {
            api1.osm.close(() => {
              _api1 = helpers.createApi(api1._dir)
              _api1.sync.listen(() => {
                api2.sync.once('peer', (peer) => {
                  sync(peer)
                })
                _api1.sync.join()
              })
            })
          })
        }
      }
    }

    function done (cb) {
      // CLOSE ONE SIDE and see that it is not connected anymore
      _api1.close(() => {
        t.notOk(api2.sync.peers()[0].connected, 'not connected anymore')
        close(cb)
      })
    }

    function sync (peer) {
      api2.sync.on('down', () => {
        t.pass('emit down event on close')
        t.notOk(peer.connected, 'not connected anymore')
      })
      var syncer = api2.sync.replicate(peer)
      syncer.on('error', function (err) {
        t.error(err)
        close(() => {
          t.fail()
        })
      })

      var totalProgressEvents = 0
      var lastProgress
      syncer.on('progress', function (progress) {
        if (!lastProgress) t.ok(peer.started, 'started is true')
        lastProgress = progress
        totalProgressEvents += 1
      })

      syncer.on('end', function () {
        t.ok(true, 'replication complete')
        var pending = 2
        var expectedMedia = mockExpectedMedia(total)
          .concat([
            'original/goodbye_world.png',
            'preview/goodbye_world.png',
            'thumbnail/goodbye_world.png'
          ])
        delete lastProgress.timestamp
        t.deepEquals(lastProgress, {
          db: { sofar: total, total: total },
          media: { sofar: expectedMedia.length, total: expectedMedia.length }
        }, 'progress state ok')
        t.ok(totalProgressEvents >= expectedMedia.length, 'all progress events fire')

        api1.media.list(function (err, files) {
          t.error(err, 'listed media1 ok')
          t.deepEquals(files.sort(), expectedMedia.sort(), 'api1 has the files')
          if (!--pending) done(() => t.pass('close ok'))
        })
        api2.media.list(function (err, files) {
          t.error(err, 'listed media2 ok')
          t.deepEquals(files.sort(), expectedMedia.sort(), 'api2 has the files')
          if (!--pending) done(() => t.pass('close ok'))
        })
      })
    }
  })
})

function mockExpectedMedia (total) {
  var expected = []
  for (var i = 0; i < total; i++) {
    expected.push(`original/foo-${i}.jpg`)
    expected.push(`thumbnail/foo-${i}.jpg`)
    expected.push(`preview/foo-${i}.jpg`)
  }
  return expected
}

function writeBlob (api, filename, cb) {
  var pending = 3
  var ws = api.media.createWriteStream('original/' + filename, done)
  ws.end(filename)

  ws = api.media.createWriteStream('preview/' + filename, done)
  ws.end(filename)

  ws = api.media.createWriteStream('thumbnail/' + filename, done)
  ws.end(filename)

  function done (err) {
    if (err) return cb(err)
    if (!--pending) cb()
  }
}

// For debugging, return a peer object that can be logged to console
function loggablePeer (peer) {
  const { connection, handshake, sync, ...loggablePeer } = peer
  loggablePeer.channel = loggablePeer.channel && loggablePeer.channel.toString('hex')
  loggablePeer.id = loggablePeer.id.toString('hex')
  return loggablePeer
}
