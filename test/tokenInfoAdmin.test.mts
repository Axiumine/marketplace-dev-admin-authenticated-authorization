import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const lean = vi.fn()
const findById = vi.fn(() => ({ lean }))
const checkUserAuthorizationDisDel = vi.fn()

vi.mock('@thedoctorweb_agency/marketplace-common/models/MongoDB/Admin', () => ({ Admin: { findById } }))
vi.mock('@thedoctorweb_agency/marketplace-common/others/checkUserAuthorizationDisDel', () => ({ checkUserAuthorizationDisDel }))

const { tokenInfoAdmin } = await import('../src/lib/auth/tokenInfoAdmin.mts')

const _id = new Types.ObjectId('507f1f77bcf86cd799439011')

describe('tokenInfoAdmin', () => {
	beforeEach(() => {
		lean.mockReset()
		findById.mockClear()
		checkUserAuthorizationDisDel.mockReset()
	})

	it('returns the lean record and runs the disabled/deleted gate on it', async () => {
		const adminData = { _id, login: { email: 'operator@marketplace.test' }, deleted: false, disabled: false }
		lean.mockResolvedValueOnce(adminData)

		await expect(tokenInfoAdmin(_id)).resolves.toBe(adminData)

		// The projection is part of the contract: the handler reads login.email off the result,
		// and the gate reads deleted/disabled.
		expect(findById).toHaveBeenCalledExactlyOnceWith({ _id }, '_id login.email deleted disabled')
		expect(checkUserAuthorizationDisDel).toHaveBeenCalledExactlyOnceWith(adminData)
	})

	it('throws unauthorized when no admin matches the id', async () => {
		lean.mockResolvedValueOnce(null)

		await expect(tokenInfoAdmin(_id)).rejects.toThrow()
		expect(checkUserAuthorizationDisDel).not.toHaveBeenCalled()
	})

	it('propagates the gate rejection for a disabled or deleted admin', async () => {
		lean.mockResolvedValueOnce({ _id, login: { email: 'operator@marketplace.test' }, disabled: true })
		checkUserAuthorizationDisDel.mockImplementationOnce(() => {
			throw new Error('disabled')
		})

		await expect(tokenInfoAdmin(_id)).rejects.toThrow('disabled')
	})
})
