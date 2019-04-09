var eos = require('end-of-stream')

module.exports = function (db, opts) {
  var multifeed = db.osm.core._logs

  var stream = multifeed.replicate(opts)

  var feeds = []
  var progress = {}
  var listeners = []

  multifeed.ready(function () {
    multifeed.feeds().forEach(onFeed)
    multifeed.on('feed', onFeed)

    eos(stream, function () {
      multifeed.removeListener('feed', onFeed)
      listeners.forEach(function (l) {
        l.feed.removeListener('download', l.listener)
      })
    })
  })

  return stream

  function onFeed (feed) {
    feeds.push(feed)
    feed.ready(updateFeed.bind(null, feed))
    feed.on('download', onDownload)
    function onDownload () {
      updateFeed(feed)
    }
    listeners.push({ feed: feed, listener: onDownload })
  }

  function updateFeed (feed) {
    progress[feed.key.toString('hex')] = feed.downloaded(0, feed.length)
    var total = feeds.reduce(function (acc, feed) { return acc + feed.length }, 0)
    var sofar = feeds.reduce(function (acc, feed) { return acc + feed.downloaded(0, feed.length) }, 0)
    stream.emit('progress', sofar, total)
  }
}
