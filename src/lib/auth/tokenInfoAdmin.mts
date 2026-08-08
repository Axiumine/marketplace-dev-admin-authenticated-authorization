import { Admin } from '@axiumine/marketplace-common/models/MongoDB/Admin'
import { IAdminEmail } from '@axiumine/marketplace-common/models/MongoDBInterfaces/IAdminEmail'
import { findAccountForSession } from '@axiumine/marketplace-common/others/findAccountForSession'
import { Types } from 'mongoose'

/**
 * Re-reads the operator behind a refresh session. The two guards — no document, then
 * disabled/deleted — are shared with the other two tiers and live in `findAccountForSession`; the
 * model and the projection are what this tier contributes.
 *
 * The projection stays here on purpose: it is the one part that genuinely differs per tier. Kept
 * inline rather than hoisted to a module constant so it is re-evaluated on every call — a top-level
 * const is evaluated once per process and no test can observe a mutation of it.
 *
 * `IAdminEmail` lives in marketplace-common rather than here because it is the *result* shape of this
 * projection, and `findAccountForSession` has to be told what it is reading. It declares the
 * `deleted`/`disabled` this projection asks for, which the interface this file used to hold inline did
 * not — even though the gate below reads exactly those two fields.
 *
 * @param _id
 */
export async function tokenInfoAdmin(_id: Types.ObjectId): Promise<IAdminEmail> {
	return findAccountForSession<IAdminEmail>(Admin, _id, '_id login.email deleted disabled')
}
