var eos = require('end-of-stream')

module.exports = function (isInitiator, db, opts) {
  var multifeed = db.osm.core._logs

  var stream = multifeed.replicate(isInitiator, opts)

  var feeds = []
  var progress = {}
  var listeners = []
  var pendingFeeds = 0

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
    ++pendingFeeds
    feed.ready(function () {
      --pendingFeeds
      feeds.push(feed)
      updateFeed(feed)
    })
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
    if (!allFeedsReady()) return
    stream.emit('progress', sofar, total)
  }

  function allFeedsReady () {
    return pendingFeeds === 0 && feeds.every(function (feed) { return feed.readable })
  }
}
