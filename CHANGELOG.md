# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [8.6.0](https://github.com/digidem/mapeo-core/compare/v8.5.0...v8.6.0) (2021-06-23)


### Features

* **export:** Optional include metadata in export ([#120](https://github.com/digidem/mapeo-core/issues/120)) ([bbbe7a0](https://github.com/digidem/mapeo-core/commit/bbbe7a0d8fadccd05efa85901a417d4c34d02805))

## [8.5.0](https://github.com/digidem/mapeo-core/compare/v8.4.0...v8.5.0) (2021-02-04)


### Features

* Add websocket sync ([#108](https://github.com/digidem/mapeo-core/issues/108)) ([59b6f42](https://github.com/digidem/mapeo-core/commit/59b6f424ec3d81b5fbe7d4ea5769e7202e02d200)), closes [#111](https://github.com/digidem/mapeo-core/issues/111) [#107](https://github.com/digidem/mapeo-core/issues/107) [#106](https://github.com/digidem/mapeo-core/issues/106) [#109](https://github.com/digidem/mapeo-core/issues/109) [#112](https://github.com/digidem/mapeo-core/issues/112) [#107](https://github.com/digidem/mapeo-core/issues/107)

## [8.4.0](https://github.com/digidem/mapeo-core/compare/v8.3.2...v8.4.0) (2020-12-17)


### Features

* Add createDataStream() for exporting data, with optional filter ([#111](https://github.com/digidem/mapeo-core/issues/111)) ([bdfae30](https://github.com/digidem/mapeo-core/commit/bdfae303db5df076a2a5cdcd8810b646d61eb951))
* Expose onConnection for direct peers ([#103](https://github.com/digidem/mapeo-core/issues/103)) ([3eb9217](https://github.com/digidem/mapeo-core/commit/3eb921751aaf52401411736ff65ce3d69b09f293))

### [8.2.0](https://github.com/digidem/mapeo-core/compare/v8.1.3...v8.2.0) (2020-05-18)

### Bug Fixes
- Peers no longer automatically sync multifeeds on connect
- `peer.id` is now exposed as a string (not a Buffer)
- More thorough closing on `close` API (also now emits `"close"` event)

### Features
- Exposed `peer.connected` property

### Deprecated
- Deprecated `peer.swarmId`
- Deprecated `peer.connection`


### [8.1.1](https://github.com/digidem/mapeo-core/compare/v8.1.0...v8.1.1) (2019-11-25)

### Bug Fixes

* Fix file sync error: pass projectKey to Syncfile as encryption key ([192b4e8](https://github.com/digidem/mapeo-core/commit/192b4e8c041a34b81e8981da6f5c99c4a12299d3))

## [8.1.0](https://github.com/digidem/mapeo-core/compare/v8.0.4...v8.1.0) (2019-11-17)


### Features

* add error metadata ([#63](https://github.com/digidem/mapeo-core/issues/63)) ([025a8b0](https://github.com/digidem/mapeo-core/commit/025a8b09fe29e12ade4162296012308e51b977ad))

### [8.0.4](https://github.com/digidem/mapeo-core/compare/v8.0.3...v8.0.4) (2019-11-14)

### ⚠ BREAKING CHANGES

* Upgrade stack to use multifeed@4 (breaking change to sync protocol).

    Clients using mapeo-core@7 will not be able to sync with clients using mapeo-core@8, and unfortunately due to a bug clients at mapeo-core@7 will not throw an error, but the @8 side will.

### Features

* Add option to sync based on a `projectKey`.

    Only clients with the same `projectKey` will be able to discover each other
  and sync. Only sync files with the same `projectKey` as the client will sync.
  If no project key is specified the default is `mapeo` and will continue to
  work with older clients.

### Bug Fixes

* projectId -> projectKey for syncfile opts ([6ab4406](https://github.com/digidem/mapeo-core/commit/6ab4406e2b4812cd48e9ed746cbf6384da134ae8))
* use discovery key in syncfile ([#62](https://github.com/digidem/mapeo-core/issues/62)) ([4a9a25b](https://github.com/digidem/mapeo-core/commit/4a9a25b87fbb7616cfba64a66ac0d80c9cb7cc48))

## [7.1.0](https://github.com/digidem/mapeo-core/compare/v7.0.3...v7.1.0) (2019-09-12)

### Bug Fixes

* Fix breaking test ([f4cf237](https://github.com/digidem/mapeo-core/commit/f4cf237))


### Features

* Use project IDs to prevent sneakernet sync between different projects ([6db8df7](https://github.com/digidem/mapeo-core/commit/6db8df7))
