const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const users = db.collection('users')
const images = db.collection('images')

const DEFAULT_NICKNAME = 'wx_user'
const ACTIVE_STATUS = 'active'
const DELETED_STATUS = 'deleted'
const MAX_LIST_LIMIT = 100

function now() {
  return Date.now()
}

function sanitizeText(input, maxLen) {
  const text = String(input || '').trim()
  if (!text) return ''
  return text.slice(0, maxLen)
}

function sanitizeAvatarUrl(input) {
  return sanitizeText(input, 2048)
}

function sanitizeNickname(nickname) {
  const text = sanitizeText(nickname, 32)
  return text || DEFAULT_NICKNAME
}

function sanitizeMeta(meta) {
  const src = meta && typeof meta === 'object' ? meta : {}
  const width = Number(src.width) || 0
  const height = Number(src.height) || 0
  const size = Number(src.size) || 0
  return {
    width: width > 0 ? width : 0,
    height: height > 0 ? height : 0,
    size: size > 0 ? size : 0,
    mimeType: sanitizeText(src.mimeType || src.mime || src.type, 64),
    ext: sanitizeText(src.ext, 16)
  }
}

function normalizeBool(input) {
  return input === true || input === 1 || input === '1' || input === 'true'
}

function clampLimit(input) {
  const n = Number(input)
  if (!Number.isFinite(n) || n <= 0) return 20
  return Math.min(Math.floor(n), MAX_LIST_LIMIT)
}

function normalizeImageDoc(doc = {}) {
  return {
    id: doc._id || '',
    userKey: doc.userKey || '',
    avatarUrl: doc.avatarUrl || '',
    fileId: doc.fileId || '',
    source: doc.source || '',
    status: doc.status || ACTIVE_STATUS,
    isActive: !!doc.isActive,
    createdAt: Number(doc.createdAt) || 0,
    updatedAt: Number(doc.updatedAt) || 0,
    deletedAt: Number(doc.deletedAt) || 0,
    meta: doc.meta || {}
  }
}

function normalizeUser(doc = {}, userKey) {
  return {
    userKey,
    nickname: doc.nickname || DEFAULT_NICKNAME,
    avatarUrl: doc.avatarUrl || '',
    createdAt: Number(doc.createdAt) || 0,
    updatedAt: Number(doc.updatedAt) || 0,
    lastLoginAt: Number(doc.lastLoginAt) || 0
  }
}

function getDocTs(doc) {
  return Number((doc && (doc.updatedAt || doc.lastLoginAt || doc.createdAt)) || 0)
}

function hasProfileData(doc) {
  return !!(doc && doc.profile && typeof doc.profile === 'object' && Object.keys(doc.profile).length)
}

function hasCustomIdentity(doc) {
  if (!doc || typeof doc !== 'object') return false
  const nickname = String(doc.nickname || '').trim()
  const avatarUrl = String(doc.avatarUrl || '').trim()
  return (!!nickname && nickname !== DEFAULT_NICKNAME) || !!avatarUrl
}

function dedupeById(list) {
  const map = {}
  ;(list || []).forEach((it) => {
    if (!it || !it._id) return
    map[it._id] = it
  })
  return Object.keys(map).map((k) => map[k])
}

function pickPreferredUserDoc(list) {
  const docs = dedupeById(list).sort((a, b) => getDocTs(b) - getDocTs(a))
  if (!docs.length) return null

  const withProfile = docs.find((d) => hasProfileData(d))
  if (withProfile) return withProfile

  const withCustom = docs.find((d) => hasCustomIdentity(d))
  if (withCustom) return withCustom

  return docs[0]
}

function userDocId(userKey) {
  const hash = crypto.createHash('md5').update(String(userKey || '')).digest('hex')
  return `u_${hash.slice(0, 24)}`
}

function avatarDocId(userKey) {
  const hash = crypto.createHash('md5').update(String(userKey || '')).digest('hex')
  return `img_${hash.slice(0, 24)}`
}

function isBlankBootstrapDoc(doc) {
  if (!doc || typeof doc !== 'object') return false
  const nickname = String(doc.nickname || '').trim()
  const avatarUrl = String(doc.avatarUrl || '').trim()
  const profile = doc.profile && typeof doc.profile === 'object' ? doc.profile : {}
  const hasProfile = Object.keys(profile).length > 0
  return (nickname === '' || nickname === DEFAULT_NICKNAME) && !avatarUrl && !hasProfile
}

function asCloudFileId(input) {
  const val = sanitizeAvatarUrl(input)
  return val.indexOf('cloud://') === 0 ? val : ''
}

function uniqueStrings(list) {
  const map = {}
  ;(list || []).forEach((it) => {
    const v = String(it || '').trim()
    if (!v) return
    map[v] = true
  })
  return Object.keys(map)
}

async function safeDeleteCloudFiles(fileList) {
  const cleanList = uniqueStrings(fileList).filter((f) => f.indexOf('cloud://') === 0)
  if (!cleanList.length) return

  try {
    if (typeof cloud.deleteFile === 'function') {
      await cloud.deleteFile({ fileList: cleanList })
    }
  } catch (e) {}
}

async function queryUsersByUserKey(userKey) {
  const res = await users.where({ userKey }).limit(20).get()
  return (res && res.data) || []
}

async function queryUsersByOpenid(openid) {
  const res = await users.where({ _openid: openid }).limit(20).get()
  return (res && res.data) || []
}

async function cleanupDuplicateUserDocs(primaryId, list) {
  if (!primaryId) return
  const docs = dedupeById(list)
  const stale = docs.filter((d) => d && d._id && d._id !== primaryId && isBlankBootstrapDoc(d))
  for (let i = 0; i < stale.length; i += 1) {
    try {
      await users.doc(stale[i]._id).remove()
    } catch (e) {}
  }
}

async function findByOpenid(openid) {
  const byKeyList = await queryUsersByUserKey(openid)
  const byOpenidList = await queryUsersByOpenid(openid)
  const candidates = [...(byKeyList || []), ...(byOpenidList || [])]
  const picked = pickPreferredUserDoc(candidates)
  if (!picked) return null

  let primary = picked
  if (picked._id && picked.userKey !== openid) {
    const ts = now()
    try {
      await users.doc(picked._id).update({
        data: {
          userKey: openid,
          updatedAt: ts
        }
      })
      primary = { ...picked, userKey: openid, updatedAt: ts }
    } catch (e) {
      primary = picked
    }
  }

  await cleanupDuplicateUserDocs(primary._id, candidates)
  return primary
}

async function ensureUser(openid) {
  const current = await findByOpenid(openid)
  if (current) return { doc: current, isNew: false }

  const ts = now()
  const _id = userDocId(openid)
  const doc = {
    _id,
    userKey: openid,
    nickname: DEFAULT_NICKNAME,
    avatarUrl: '',
    profile: {},
    createdAt: ts,
    updatedAt: ts,
    lastLoginAt: ts
  }

  try {
    await users.add({ data: doc })
    return { doc, isNew: true }
  } catch (e) {
    const fallback = await findByOpenid(openid)
    if (fallback) return { doc: fallback, isNew: false }

    try {
      const byId = await users.doc(_id).get()
      if (byId && byId.data) return { doc: byId.data, isNew: false }
    } catch (ignored) {}

    throw e
  }
}

async function listUserAvatarDocs(userKey) {
  const res = await images.where({ userKey }).limit(MAX_LIST_LIMIT).get()
  return (res && res.data) || []
}

function pickCurrentAvatarDoc(list) {
  const docs = dedupeById(list).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  if (!docs.length) return null

  const active = docs.find((d) => d.status === ACTIVE_STATUS && d.isActive)
  if (active) return active

  const alive = docs.find((d) => d.status === ACTIVE_STATUS)
  if (alive) return alive

  return docs[0]
}

async function findImageByIdForUser(userKey, imageId, includeDeleted = false) {
  if (!imageId) return null
  try {
    const res = await images.doc(imageId).get()
    const doc = (res && res.data) || null
    if (!doc) return null
    if (String(doc.userKey || '') !== String(userKey || '')) return null
    if (!includeDeleted && doc.status === DELETED_STATUS) return null
    return doc
  } catch (e) {
    return null
  }
}

async function cleanupAvatarDocsAndFiles(userKey, keepDocId, keepFileId) {
  const docs = await listUserAvatarDocs(userKey)
  const removeDocIds = []
  const removeFileIds = []

  for (let i = 0; i < docs.length; i += 1) {
    const doc = docs[i]
    if (!doc || !doc._id) continue
    if (keepDocId && doc._id === keepDocId) continue

    removeDocIds.push(doc._id)
    const fileId = asCloudFileId(doc.fileId || doc.avatarUrl)
    if (fileId && fileId !== keepFileId) removeFileIds.push(fileId)
  }

  for (let i = 0; i < removeDocIds.length; i += 1) {
    try {
      await images.doc(removeDocIds[i]).remove()
    } catch (e) {}
  }

  await safeDeleteCloudFiles(removeFileIds)
}

async function syncUserAvatar(userDoc, userKey, avatarUrl, ts) {
  const current = userDoc || {}
  const nextAvatar = sanitizeAvatarUrl(avatarUrl)
  const currentProfile = current.profile && typeof current.profile === 'object' ? current.profile : {}
  const nextNickname = sanitizeNickname(current.nickname || currentProfile.nickname)

  const nextProfile = {
    ...currentProfile,
    nickname: sanitizeNickname(currentProfile.nickname || nextNickname),
    avatarUrl: nextAvatar
  }

  await users.doc(current._id).update({
    data: {
      userKey,
      nickname: nextNickname,
      avatarUrl: nextAvatar,
      profile: nextProfile,
      updatedAt: ts
    }
  })

  return {
    ...current,
    userKey,
    nickname: nextNickname,
    avatarUrl: nextAvatar,
    profile: nextProfile,
    updatedAt: ts
  }
}

async function doSaveAvatar(openid, payload = {}) {
  const { doc: userDoc } = await ensureUser(openid)

  const avatarUrl = sanitizeAvatarUrl(payload.avatarUrl || payload.url || payload.fileID || payload.fileId)
  if (!avatarUrl) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'avatarUrl is required'
    }
  }

  const nextFileId = sanitizeAvatarUrl(payload.fileId || payload.fileID || avatarUrl)
  const source = sanitizeText(payload.source, 32) || 'edit_profile'
  const meta = sanitizeMeta(payload.meta)
  const ts = now()
  const docId = avatarDocId(openid)

  const existing = await findImageByIdForUser(openid, docId, true)
  const prevFileId = existing ? asCloudFileId(existing.fileId || existing.avatarUrl) : ''

  const nextDoc = {
    userKey: openid,
    avatarUrl,
    fileId: nextFileId,
    source,
    meta,
    status: ACTIVE_STATUS,
    isActive: true,
    createdAt: existing && existing.createdAt ? existing.createdAt : ts,
    updatedAt: ts,
    deletedAt: 0
  }

  await images.doc(docId).set({ data: nextDoc })

  await cleanupAvatarDocsAndFiles(openid, docId, asCloudFileId(nextFileId || avatarUrl))

  if (prevFileId) {
    const keepFileId = asCloudFileId(nextFileId || avatarUrl)
    if (prevFileId !== keepFileId) {
      await safeDeleteCloudFiles([prevFileId])
    }
  }

  const updatedUser = await syncUserAvatar(userDoc, openid, avatarUrl, ts)
  const saved = await findImageByIdForUser(openid, docId, true)

  return {
    ok: true,
    image: normalizeImageDoc(saved || { _id: docId, ...nextDoc }),
    user: normalizeUser(updatedUser, openid)
  }
}

async function doGetCurrentAvatar(openid) {
  const { doc: userDoc } = await ensureUser(openid)
  const docId = avatarDocId(openid)

  const direct = await findImageByIdForUser(openid, docId)
  if (direct) {
    return {
      ok: true,
      image: normalizeImageDoc(direct),
      user: normalizeUser(userDoc, openid)
    }
  }

  const docs = await listUserAvatarDocs(openid)
  const current = pickCurrentAvatarDoc(docs)
  if (!current || current.status === DELETED_STATUS) {
    return {
      ok: true,
      image: null,
      user: normalizeUser(userDoc, openid)
    }
  }

  const migrated = await doSaveAvatar(openid, {
    avatarUrl: current.avatarUrl,
    fileId: current.fileId,
    source: current.source || 'migrate',
    meta: current.meta || {}
  })

  return {
    ok: true,
    image: migrated.image || null,
    user: migrated.user || normalizeUser(userDoc, openid)
  }
}

async function doListAvatars(openid, payload = {}) {
  await ensureUser(openid)
  const includeDeleted = normalizeBool(payload.includeDeleted)
  const limit = clampLimit(payload.limit)

  const docs = await listUserAvatarDocs(openid)
  const sorted = dedupeById(docs).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
  const filtered = includeDeleted ? sorted : sorted.filter((d) => d.status !== DELETED_STATUS)
  const list = filtered.slice(0, limit).map((d) => normalizeImageDoc(d))
  const current = list.find((d) => d.isActive && d.status === ACTIVE_STATUS) || list[0] || null

  return {
    ok: true,
    list,
    current
  }
}

async function doSetCurrentAvatar(openid, payload = {}) {
  const imageId = sanitizeText(payload.imageId || payload.id, 64)
  if (!imageId) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'imageId is required'
    }
  }

  const target = await findImageByIdForUser(openid, imageId, true)
  if (!target) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'avatar image not found'
    }
  }

  return doSaveAvatar(openid, {
    avatarUrl: target.avatarUrl,
    fileId: target.fileId,
    source: target.source || 'set_current',
    meta: target.meta || {}
  })
}

async function doDeleteAvatar(openid, payload = {}) {
  const { doc: userDoc } = await ensureUser(openid)
  const imageId = sanitizeText(payload.imageId || payload.id, 64)

  let target = null
  if (imageId) {
    target = await findImageByIdForUser(openid, imageId, true)
  } else {
    const current = await doGetCurrentAvatar(openid)
    if (current && current.image && current.image.id) {
      target = await findImageByIdForUser(openid, current.image.id, true)
    }
  }

  if (!target) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'avatar image not found'
    }
  }

  const docs = await listUserAvatarDocs(openid)
  const removeDocIds = dedupeById(docs).map((d) => d._id).filter(Boolean)
  const removeFileIds = dedupeById(docs)
    .map((d) => asCloudFileId(d.fileId || d.avatarUrl))
    .filter(Boolean)

  for (let i = 0; i < removeDocIds.length; i += 1) {
    try {
      await images.doc(removeDocIds[i]).remove()
    } catch (e) {}
  }

  await safeDeleteCloudFiles(removeFileIds)

  const ts = now()
  const updatedUser = await syncUserAvatar(userDoc, openid, '', ts)

  return {
    ok: true,
    deletedId: target._id || '',
    current: null,
    user: normalizeUser(updatedUser, openid)
  }
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return {
      ok: false,
      code: 'NO_OPENID',
      message: 'OPENID is unavailable'
    }
  }

  try {
    const action = String(event.action || 'getCurrentAvatar')

    if (action === 'saveAvatar') {
      const result = await doSaveAvatar(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'setCurrentAvatar') {
      const result = await doSetCurrentAvatar(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'deleteAvatar') {
      const result = await doDeleteAvatar(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'listAvatars') {
      const result = await doListAvatars(openid, event)
      return { ...result, openid, userKey: openid }
    }

    const result = await doGetCurrentAvatar(openid)
    return { ...result, openid, userKey: openid }
  } catch (error) {
    return {
      ok: false,
      code: 'SERVER_ERROR',
      message: error && error.message ? error.message : 'cloud function failed',
      openid,
      userKey: openid
    }
  }
}
