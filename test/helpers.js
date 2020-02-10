var path = require('path')
var fs = require('fs')
var pump = require('pump')
var randombytes = require('randombytes')
var osmdb = require('osm-p2p')
var blobstore = require('safe-fs-blob-store')
var tmp = require('tmp')
var mock = require('mock-data')
var run = require('run-parallel-limit')
var series = require('run-series')
var crypto = require('crypto')

var Mapeo = require('..')

function noop () {}

module.exports = {
  createApi: createOneApi,
  createApis: createTwoApis,
  writeBigData,
  writeObservations,
  writeMedia,
  generateObservations,
  populateWithData,
  startSync
}

function createOneApi (opts, cb) {
  if (!cb && typeof opts === 'function') {
    cb = opts
    opts = undefined
  }
  opts = opts || {}

  var tmpdir = tmp.dirSync()
  var dir = tmpdir.name

  var osm = osmdb(dir)
  var media = blobstore(path.join(dir, 'media'))

  var api = new Mapeo(osm, media, Object.assign({}, {
    id: randombytes(8).toString('hex')
  }, opts))

  function close (cb) {
    api.close(function () {
      tmpdir.removeCallback()
      ;(cb || noop)()
    })
  }

  api.ready(function () {
    cb(api, close)
  })
}

function createTwoApis (opts, cb) {
  if (!cb && typeof opts === 'function') {
    cb = opts
    opts = undefined
  }
  opts = opts || {}

  createOneApi(opts.api1, function (api1, close1) {
    createOneApi(opts.api2, function (api2, close2) {
      function close (cb) {
        close1(function () {
          close2(function () {
            if (cb) cb()
          })
        })
      }
      cb(api1, api2, close)
    })
  })
}

// Generate + write N observations to a mapeo-core instance.
function writeObservations (mapeo, n, cb) {
  if (n === 0) return process.nextTick(cb)
  var left = n
  generateObservations(n, function (_, obs, i) {
    mapeo.observationCreate(obs, (_, node) => {
      if (--left === 0) cb()
    })
  })
}

// Generate + write N photos (of {hi,medium,lo} res size) to a mapeo-core instance.
function writeMedia (mapeo, n, cb) {
  if (n === 0) return process.nextTick(cb)

  var tasks = []

  // Produces a task for writing a media file to the media store.
  function media (inName, outName) {
    return function (cb) {
      var ws = mapeo.media.createWriteStream(outName, cb)
      var rs = fs.createReadStream(path.join(__dirname, inName))
      pump(rs, ws)
    }
  }

  var prefix = String(Math.random()).substring(2, 10)

  for (var i = 0; i < n; i++) {
    if (i % 3 === 0) {
      tasks.push(media('hi-res.jpg', `original/${prefix}-${i}.jpg`))
    } else if (i % 3 === 1) {
      tasks.push(media('medium-res.jpg', `preview/${prefix}-${i}.jpg`))
    } else {
      tasks.push(media('lo-res.jpg', `thumbnail/${prefix}-${i}.jpg`))
    }
  }

  run(tasks, 10, cb)
}

function writeBigData (mapeo, n, cb) {
  if (n === 0) return process.nextTick(cb)
  var tasks = []

  generateObservations(n, function (_, obs, i) {
    mapeo.observationCreate(obs, (_, node) => {
      var task = function (cb) {
        var pending = 6
        var error
        var ws, rs

        ws = mapeo.media.createWriteStream(`preview/foo-${i}.jpg`, done)
        rs = fs.createReadStream(path.join(__dirname, 'medium-res.jpg'))
        pump(rs, ws, done)

        ws = mapeo.media.createWriteStream(`thumbnail/foo-${i}.jpg`, done)
        rs = fs.createReadStream(path.join(__dirname, 'lo-res.jpg'))
        pump(rs, ws, done)

        ws = mapeo.media.createWriteStream(`original/foo-${i}.jpg`, done)
        rs = fs.createReadStream(path.join(__dirname, 'hi-res.jpg'))
        pump(rs, ws, done)

        function done (err) {
          if (error) return
          if (err) {
            error = err
            cb(err)
          } else if (!--pending) {
            cb()
          }
        }
      }
      tasks.push(task)

      if (tasks.length === n) {
        run(tasks, 10, function (err) {
          if (err) return cb(err)
          mapeo.media.list(function (_, files) {
            if (files.length !== n * 3) {
              console.log(`ERROR: not enough images were created! (${files.length} / ${n * 3}) have:`)
              files.forEach(f => console.log(f))
              return cb(new Error('Error creating images, not enough were created'))
            }
            cb()
          })
        })
      }
    })
  })
}

// Sets up both sides to sync & initiates the sync. Returns the 'syncer' EventEmitter.
function startSync (api1, api2, cb) {
  var swarmId = crypto.randomBytes(32)
  api1.sync.listen()
  api1.sync.join(swarmId)
  api1.sync.once('peer', ready)
  api2.sync.listen()
  api2.sync.join(swarmId)
  api2.sync.once('peer', ready)

  var pending = 2
  function ready () {
    if (--pending > 0) return
    if (!api1.sync.peers().length || !api2.sync.peers().length) return cb(new Error('could not find other peer'))

    var syncer = api1.sync.replicate(api1.sync.peers()[0])
    cb(null, syncer)
  }
}

function sync (api1, api2, cb) {
  startSync(api1, api2, function (err, syncer) {
    if (err) return cb(err)
    syncer.once('error', cb)
    syncer.once('end', function () {
      api1.sync.destroy(function () {
        api2.sync.destroy(cb)
      })
    })
  })
}

function generateObservations (count, bounds, cb) {
  if (!cb && typeof bounds === 'function') {
    cb = bounds
    bounds = [-78.3155, -3.3493, -74.9871, 0.6275]
    bounds = bounds.map((b) => b * 100)
  }
  mock.generate({
    type: 'integer',
    count: count,
    params: { start: bounds[0], end: bounds[2] }
  }, function (err, lons) {
    if (err) return cb(err)
    mock.generate({
      type: 'integer',
      count: count,
      params: { start: bounds[1], end: bounds[3] }
    }, function (err, lats) {
      if (err) return cb(err)
      lons.forEach((lon, i) => {
        var obs = {
          type: 'observation',
          lat: lats[i] / 100,
          lon: lon / 100,
          tags: {
            notes: '',
            observedBy: 'you'
          }
        }
        count--
        cb(null, obs, count)
      })
    })
  })
}

// Populate N mapeo-core instances with random data & certain amount of
// overlap.
//
// The structure of 'setup' can be some subset of:
// {
//   commonObservations: Number,
//   commonMedia: Number,
//   cores: [
//     {
//       uniqueObservations: Number,
//       uniqueMedia: Number
//     },
//     {
//       uniqueObservations: Number,
//       uniqueMedia: Number
//     },
//   ],
//   syncs: [
//     [ i, j ],   // sync core[i] and core[j]
//     ...
//   ]
// }
var defaultPopulateSetup = {
  commonObservations: 0,
  commonMedia: 0,
  cores: [],
  syncs: []
}
function populateWithData (setup, cb) {
  var opts = Object.assign({}, defaultPopulateSetup, setup)

  if (!opts.cores.length) return process.nextTick(cb)

  // 0. create Mapeo Core instances
  var tasks = []
  opts.cores.forEach(function (core) {
    tasks.push(function (cb) {
      createOneApi(function (api, close) {
        core.api = api
        core.cleanup = close
        cb()
      })
    })
  })

  // 1. write common observations & media
  tasks.push(function (cb) {
    writeObservations(opts.cores[0].api, opts.commonObservations, cb)
  })
  tasks.push(function (cb) {
    writeMedia(opts.cores[0].api, opts.commonMedia, cb)
  })

  // 2. sync api0 to api1,api2,...,apiN
  opts.cores.forEach(function (entry, i) {
    if (i === 0) return // skip api0
    var task = function (cb) {
      sync(opts.cores[0].api, entry.api, cb)
    }
    tasks.push(task)
  })

  // 3. write unique observations + media to api1,api2,...,apiN
  opts.cores.forEach(function (entry, i) {
    var observationTask = function (cb) {
      writeObservations(entry.api, entry.uniqueObservations, cb)
    }
    var mediaTask = function (cb) {
      writeMedia(entry.api, entry.uniqueMedia, cb)
    }
    tasks.push(observationTask)
    tasks.push(mediaTask)
  })

  // 4. do syncs
  opts.syncs.forEach(function (pair) {
    var task = function (cb) {
      sync(opts.cores[pair[0]].api, opts.cores[pair[1]].api, cb)
    }
    tasks.push(task)
  })

  // 5. create a new aggregate 'close' function
  var closeAll = function (cb) {
    var tasks = opts.cores.map(core => core.cleanup)
    series(tasks, cb)
  }

  // 6. do everything!
  series(tasks, function (err) {
    if (err) cb(err)
    else cb(null, opts.cores.map(c => c.api), closeAll)
  })
}
