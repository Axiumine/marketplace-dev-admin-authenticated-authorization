import { TCommonHeaders } from '@axiumine/koa-utils/graphQL/schema/context/TCommonHeaders'
import { ICookies } from '@axiumine/koa-utils/lib/ICookies'
import { IRedisDataAdmin } from '@thedoctorweb_agency/marketplace-common/others/Redis/IRedisDataAdmin'
import { IncomingHttpHeaders } from 'http'

interface IRedisDataAdminForNodeAuthenticatedAuthorization extends IRedisDataAdmin {
	refreshToken: string
}

type IStateApi = {
	user: IRedisDataAdminForNodeAuthenticatedAuthorization
}
export type IContextAuthenticatedAuthorization = {
	state: IStateApi
	cookies: ICookies
	request: {
		header?: TCommonHeaders & IncomingHttpHeaders
	}
}
