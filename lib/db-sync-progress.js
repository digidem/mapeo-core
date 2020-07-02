var eos = require('end-of-stream')

module.exports = function (db, opts) {
  var multifeed = db.osm.core._logs

  var stream = multifeed.replicate(opts)

  var feeds = new Map()
  var listeners = []

  multifeed.ready(function () {
    multifeed.feeds().forEach(onFeed)
    multifeed.on('feed', onFeed)
    stream.on('remote-feeds', onRemoteFeeds)

    function onRemoteFeeds () {
      multifeed.feeds().forEach(onFeed)
    }

    eos(stream, function () {
      multifeed.removeListener('feed', onFeed)
      stream.removeListener('remote-feeds', onRemoteFeeds)
      listeners.forEach(function (l) {
        l.feed.removeListener('upload', l.listener)
        l.feed.removeListener('download', l.listener)
      })
    })
  })

  return stream

  function onFeed (feed) {
    if (!feed.writable && feeds.has(feed.key.toString('hex'))) return
    feeds.set(feed.key.toString('hex'), feed)
    feed.ready(updateFeed.bind(null, feed))
    feed.on('download', listener)
    feed.on('upload', listener)

    function listener () {
      updateFeed(feed)
    }
    listeners.push({ feed, listener })
  }

  function updateFeed (feed) {
    var all = Array.from(feeds.values())
    var total = all.reduce(function (acc, feed) {
      return acc + feed.length
    }, 0)
    var sofar = all.reduce(function (acc, feed) {
      return acc + feed.downloaded(0, feed.length)
    }, 0)
    stream.emit('progress', sofar, total)
  }
}
