import pkg from '../../package.json';

export const APP_NAME = 'Skyrim Dungeon Planner';
/** From package.json, the one place the version is set (a release tag is `v<version>`). */
export const APP_VERSION: string = pkg.version;
