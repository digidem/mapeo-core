var eos = require('end-of-stream')

module.exports = function (isInitiator, {osm}, opts) {
  var multifeed = osm.core._logs
  var sofar = 0
  var total = null

  var stream = multifeed.replicate(isInitiator, opts)

  var listeners = []
  var pendingFeeds = 0

  multifeed.ready(function () {
    multifeed.feeds().forEach(onFeed)
    multifeed.on('feed', onFeed)

    eos(stream, function () {
      multifeed.removeListener('feed', onFeed)
      listeners.forEach(function (l) {
        l.feed.removeListener('download', l.listener)
        l.feed.removeListener('upload', l.listener)
      })
    })
  })

  stream.setTotals = function (down, up) {
    total = down + up
  }

  return stream

  function onFeed (feed) {
    ++pendingFeeds
    feed.ready(function () {
      --pendingFeeds
    })
    feed.on('download', onProgress)
    feed.on('upload', onProgress)
    function onProgress () {
      sofar++
      onUpdate(feed)
    }
    listeners.push({ feed: feed, listener: onProgress })
  }

  function onUpdate (feed) {
    if (!allFeedsReady()) return
    stream.emit('progress', sofar, total)
  }

  function allFeedsReady () {
    return pendingFeeds === 0 && sofar > 0 && total !== null
  }
}
