var mkdirp = require('mkdirp')
var path = require('path')
var fs = require('fs')
var pump = require('pump')
var randombytes = require('randombytes')
var osmdb = require('osm-p2p')
var blobstore = require('safe-fs-blob-store')
var tmp = require('tmp')
var mock = require('mock-data')
var run = require('run-parallel-limit')

var Mapeo = require('..')

module.exports = {
  createApi,
  writeBigDataNoPhotos,
  writeBigData,
  generateObservations
}

function createApi (_dir, opts) {
  var dir = _dir || tmp.dirSync().name

  mkdirp.sync(dir)

  var osm = osmdb(Object.assign({
    dir
  }, opts))
  var media = blobstore(path.join(dir, 'media'))

  var mapeo = new Mapeo(osm, media, Object.assign({}, opts, {
    id: randombytes(8).toString('hex')
  }))

  osm.close = function (cb) {
    this.index.close(cb)
  }

  mapeo._dir = dir
  return mapeo
}

function writeBigDataNoPhotos (mapeo, n, cb) {
  generateObservations(n, function (_, obs, i) {
    mapeo.observationCreate(obs, (_, node) => {
      if (i === 0) {
        cb()
      }
    })
  })
}

function writeBigData (mapeo, n, cb) {
  var tasks = []
  var left = n

  generateObservations(n, function (_, obs, i) {
    mapeo.observationCreate(obs, (_, node) => {
      var task = function (cb) {
        var pending = 6
        var error

        var ws = mapeo.media.createWriteStream(`preview/foo-${i}.jpg`, done)
        var rs = fs.createReadStream(path.join(__dirname, 'hi-res.jpg'))
        pump(rs, ws, done)

        var ws = mapeo.media.createWriteStream(`thumbnail/foo-${i}.jpg`, done)
        var rs = fs.createReadStream(path.join(__dirname, 'hi-res.jpg'))
        pump(rs, ws, done)

        var ws = mapeo.media.createWriteStream(`original/foo-${i}.jpg`, done)
        var rs = fs.createReadStream(path.join(__dirname, 'hi-res.jpg'))
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
              console.log(`ERROR: not enough images were created! (${files.length} / ${n*3}) have:`)
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
