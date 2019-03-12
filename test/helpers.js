var mkdirp = require('mkdirp')
var tmp = require('os-tmpdir')
var path = require('path')
var rimraf = require('rimraf')
var randombytes = require('randombytes')
var Osm = require('osm-p2p')
var blobstore = require('safe-fs-blob-store')

var Mapeo = require('..')

var tmpdir1 = path.join(tmp(), 'mapfilter-sync-server-test-files')
var tmpdir2 = path.join(tmp(), 'mapfilter-sync-server-test-files-2')

module.exports = {
  tmpdir1, tmpdir2, createApi, cleanupSync
}

function createApi (dir, opts) {
  rimraf.sync(dir)
  mkdirp.sync(dir)
  var osm = Osm(dir)
  var media = blobstore(path.join(dir, 'media'))
  return new Mapeo(osm, media, Object.assign({}, opts, {
    id: randombytes(8).toString('hex')
  }))
}

function cleanupSync () {
  rimraf.sync(tmpdir1)
  rimraf.sync(tmpdir2)
}
