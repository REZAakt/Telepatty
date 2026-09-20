import { PROTOCOL_VERSION } from './protocol'
export { PROTOCOL_VERSION }
/** Protocol versioning: the wire `v` field is the MAJOR. Parse versions with a
 *  larger major are refused with the "update the app" guard; MINOR additions
 *  (v1.1: replyTo object, file transfer) stay backward compatible. */
export const PROTOCOL_MAJOR = 1
export const PROTOCOL_MINOR = 1
export const SCHEMA_VERSION = 5
