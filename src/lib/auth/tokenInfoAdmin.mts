import { throwUnauthorizedError } from '@axiumine/koa-utils/graphQL/throw/throwUnauthorizedError'
import { Admin } from '@thedoctorweb_agency/marketplace-common/models/MongoDB/Admin'
import { checkUserAuthorizationDisDel } from '@thedoctorweb_agency/marketplace-common/others/checkUserAuthorizationDisDel'
import { Types } from 'mongoose'

interface IAdminEmail {
	_id: Types.ObjectId
	login: {
		email: string
	}
}

/**
 * Try to login not admin user
 * @param _id
 */
export async function tokenInfoAdmin(_id: Types.ObjectId): Promise<IAdminEmail> {
	const adminData = await Admin.findById({ _id: _id }, '_id login.email deleted disabled').lean()

	if (adminData === null) {
		throw throwUnauthorizedError()
	}
	checkUserAuthorizationDisDel(adminData)
	return adminData
}
