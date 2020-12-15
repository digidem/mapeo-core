# @mapeo/core

[![Build
Status](https://travis-ci.org/digidem/mapeo-core.svg?branch=master)](https://travis-ci.org/digidem/mapeo-core)

Offline p2p mapping library.


```
npm install @mapeo/core
```

## API

```
var Mapeo = require('@mapeo/core')
```

### `mapeo = new Mapeo(osm, media, opts)`

* `osm`: an [osm-p2p](http://github.com/digidem/kappa-osm) (or [kappa-osm](http://github.com/digidem/kappa-osm)) instance
* `media`: a blob storage instance (e.g., [safe-fs-blob-store](http://npmjs.com/safe-fs-blob-store))
* `opts`: options

Valid `opts` options include:

* `opts.deviceType` (string): one of `{'desktop', 'mobile'}`. This affects how sync works. Mobile peers will not receive full-resolution media from other devices, but share them *to* desktop devices.
* `opts.internetDiscovery` (boolean): set to `true` if you want to discover peers on the internet. Otherwise only local network peers will be sought after.

## Observations API

A observation is a point on the map with particular metadata.

See the [spec]..

Validated fields:

* `type`: (required) must be the string literal `"observation"`
* `attachments`: (optional) array of attachments, each with an `id`.
* `lat`: (required) latitude
* `lon`: (required) longitude

### `mapeo.observationCreate(obs, cb)`

Create an observation.

### `mapeo.observationGet(id, cb)`

Get the observation with the given id.

### `mapeo.observationUpdate(newObservation, cb)`

Update the observation. It requires valid `version` and `id` fields that
reference the observation you are updating.

### `mapeo.observationDelete(id, cb)`

Delete the observation with the given id. Also deletes attached media.

### `mapeo.observationStream(opts)`

Returns a stream of observations. By default only the most recent forks are
returned (e.g. it will will return only one version of each observation id),
sorted by timestamp. Options for filtering the data can be passed
according to the [levelup createReadStream
API](https://github.com/Level/levelup#createReadStream).

Valid `opts` include:

* `opts.forks` - Defaults to `false`. If `true` then if multiple heads/forks
  exist for an observation ID (e.g. if two users have edited the same
  observation and then synced) then all forks are returned. By default, when
  `false`, only the most recent fork is returned.

### `mapeo.observationList(opts, cb)`

Returns an array of observations to the given `callback`. By default only the
most recent forks are returned (e.g. it will will return only one version of
each observation id), sorted by timestamp. Any errors are propagated as the
first argument to the callback. Same options accepted as
`mapeo.observationStream`.

### `mapeo.exportData(filename, opts, cb)`

Exports data from the osm database to the given filename.

Valid `opts` include:

* `opts.format`: "geojson" or a "shapefile". Shapefiles export into zip
  format.
* `opts.presets`: an object that represents the contents of a `presets.json` file

### `mapeo.createDataStream(opts)`

Create a ReadableStream of data in the Mapeo OSM (Territory) database, in either GeoJSON or Shapefile format. The stream for Shapefiles is a zip file.

Valid `opts` include:

* `opts.format`: "geojson" or a "shapefile". Shapefiles export into zip
  format.
* `opts.presets`: an object that represents the contents of a `presets.json` file

### `mapeo.observationConvert(obs, cb)`

Convert an observation to an OSM type `node`.

### `mapeo.getDeviceId(cb)`

Retrieves the current device's unique ID (string).

### `mapeo.getFeedStatus(cb)`

Retrieves the status of the feeds, returns an array of feeds, containing the Device IDs and their download status.

```
{
  [{
    id: DeviceID (String[64]),
    sofar: Number,
    total: Number
  }]
}
```


## Sync API

Mapeo core provides some key functionality for syncing between two devices over
WiFi and filesystem (i.e., over USB sneakernets).

```js
var sync = mapeo.sync

sync.listen(function () {

})
```

### sync.setName(name)

Set the name of this peer / device, which will appear to others when they call
`sync.peers()`.

### sync.listen(cb)

Broadcast and listen on the local network for peers. `cb` is called once the service is up and broadcasting.

### sync.join([projectKey])

Join the swarm and begin making introductory connections with other peers.

Optionally accepts a `projectKey` which must be a 32-byte buffer or a string hex encoding of a 32-byte buffer. This will swarm only with peers that have also passed in the same `projectKey`.

An invalid `projectKey` will throw an error.

### sync.leave([projectKey])

Leave the swarm and no longer be discoverable by other peers. Any currently
open connections are kept until the swarm is destroyed (using `close` or
`destroy`).

Optionally accepts a `projectKey` which must be a 32-byte buffer or a string hex encoding of a 32-byte buffer, to leave the same swarm you joined.

An invalid `projectKey` will throw an error.

### sync.close([cb])

Unannounces the sync service & cleans up the underlying UDP socket. Optionally accepts `cb` which is called once this is complete.

Emits `close` event.

### sync.peers()

Fetch a list of the current sync peers that have been found thus far.

A peer can have the following properties:

* `name` (string): a human-readable identifier for the peer (e.g., hostname)
* `connected` (boolean): whether the peer is currently connected to you
* `host` (string): the ip
* `port` (number): the port
* `type` (string): 'wifi' or 'file'
* `deviceType` (string): either `mobile` or `desktop`, if `type == 'wifi'`

### sync.on('peer', peer)

Emitted when a new wifi peer connection is discovered.

### var ev = sync.replicate(target[, opts])

`peer` is an object with properties `host`, `port`, and `name` **or** an object
with the `filename` property, for local file replication. Calls
`replicateFromFile` or `replicateNetwork` below.

`filename` is a string specifying where the find the file to sync with. If it
doesn't exist, it will be created, and use the format specified in the
constructor's `opts.writeFormat`.

Both `replicate` and `replicateNetwork` return an EventEmitter `ev`. It can emit

* `"error" (err)`: gives an Error object signalling an error in syncing.
* `"progress" (progress)`: gives information about how many objects have been synced and how many to be synced in total, e.g. `{ db: { sofar: 5, total: 10 }, media: { sofar: 18, total: 100 } }`
* `"end"`: successful completion of OSM and media sync.

Valid `opts` include:

- `opts.projectKey` (string): a unique identifier that prohibits sync with a
  syncfile that declares a different project ID. If either side doesn't have a
  project ID set, sync will be permitted.

### var ev = sync.replicateNetwork(peer)

`peer` should be an already-discoverable peer object, emitted from the `peer`
event or returned on the `peers()` method.

If you want to replicate with a peer that is not discovered yet, but you have
the host and port, we haven't made this easy at the moment. The code is written
internally but not exposed via a public API. PRs welcome.

## Importer API (expertimental)

The Importer allows you to import data to the osm database from other formats.

### ``mapeo.importer``

This object reports on import progress with the `progress`,
`complete`, and `error` events.

For example,

```
var mapeo = new Mapeo(osm, media)
mapeo.importer.on('progress', console.log)
mapeo.importer.on('error', console.error)
mapeo.importer.on('complete', () => { process.exit() })
mapeo.importFeatureCollection(myGeoJsonFile)
```

### `mapeo.importer.importFeatureCollection(geojson, [cb])`

Import data from a geojson string. This is simply a wrapper around `osm-p2p-geojson`.

### `mapeo.importer.importFromFile(filename, [cb])`

Import data from a `.geojson` file or a `.shp` file.

## Security Notes

### "Can a passive listener learn about Mapeo project data?"

By default, peer discovery and sync happens over the local network only, and not the internet. If a malicious computer on the network is listening to packets, they will be able to learn of a project's "discovery key": a blake2b hash of the project's "project key". The discovery key is a mechanism to help peers in the same project find each other (on the local network or the internet), but on its own is insufficient to decrypt communications between peers. The project key *must* be known by a peer in order to decrypt any data exchanged. So, passive listeners will be able to ascertain a unique identifier for a project and learn which IPs are interested in it, but not any of the data exchanged by those peers.

## Community

Connect with the Mapeo community for support & to contribute!

- [**Mailing List**](https://lists.riseup.net/www/info/mapeo-en) (English)
- [**Mailing List**](https://lists.riseup.net/www/info/mapeo-es) (Spanish)
- [**IRC**](https://kiwiirc.com/nextclient/irc.freenode.net/) (channel #ddem)
- [**Slack**](http://slack.digital-democracy.org)

## License

MIT
