# mapeo-core

[![Build
Status](https://travis-ci.org/digidem/mapeo-core.svg?branch=master)](https://travis-ci.org/digidem/mapeo-core)


Media and observations store for osm-p2p.

```
npm install mapeo-core
```

## API

```
var MapfilterDb = require('mapeo-core')
```

### `db = MapfilterDb(osmdir)`

* `osmdir`: the path where db will store data on the local filesystem

Create a new Mapfilter-compatible database. The database will be stored in `osmdir`.

### `db.mediaRead(name, cb)`

Reads the file from the media store.

* `name`: filename to read

### `db.mediaCreate(filename, data, opts, cb)`

Create a file on the media store

* `filename`: filename to write
* `data`: The data in the file

### `stream = db.createOsmReplicationStream()`

Create a replication stream for the OSM observation data.

### `stream = db.createMediaReplicationStream()`

Create a replication stream for the media files.

### `db.replicateWithDirectory(dir, opts, cb)`

Replicate all data (observation and media) to a particular directory in an archive
that can be used to sync across USB sticks, for example.

### `db.observationCreate(feature, cb)`

Create a new observation given the feature. Will fail if an object with the
same id already exists. In that case, use `observationUpdate` more explicitly.

### `db.observationUpdate(feature, cb)`

Update an observation given the feature.

### `db.observationList(opts, cb)`

List all observations, returns an array of JSON objects. Can pass `{features: true}` to get a list of GeoJSON features instead of observations.

### `db.observationStream(opts)`

Returns an object stream of all observations. Can pass `{features: true}` to convert each into a GeoJSON feature.

### `db.observationToFeature(observation)`

Convert a given observation object to a GeoJSON feature.

### `db.close(cb)`

Close the database.

## License

MIT
