var mkdirp = require('mkdirp')
var path = require('path')
var rimraf = require('rimraf')
var randombytes = require('randombytes')
var Osm = require('osm-p2p')
var blobstore = require('safe-fs-blob-store')
var tmp = require('tmp')

var Mapeo = require('..')

module.exports = {
  createApi
}

function createApi (_, opts) {
  var dir = tmp.dirSync().name
  rimraf.sync(dir)
  mkdirp.sync(dir)
  var osm = Osm(dir)
  var media = blobstore(path.join(dir, 'media'))
  return new Mapeo(osm, media, Object.assign({}, opts, {
    id: randombytes(8).toString('hex')
  }))
}
