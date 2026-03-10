const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const users = db.collection('users')
const works = db.collection('works')
const workInteractions = db.collection('work_interactions')
const workComments = db.collection('work_comments')

const ACTIVE_STATUS = 'active'
const DELETED_STATUS = 'deleted'
const DEFAULT_NICKNAME = 'wx_user'
const DEFAULT_WORK_TITLE = 'tryon_work'
const MAX_LIST_LIMIT = 100

function now() {
  return Date.now()
}

function sanitizeText(input, maxLen) {
  const text = String(input || '').trim()
  if (!text) return ''
  return text.slice(0, maxLen)
}

function sanitizeNickname(input) {
  const text = sanitizeText(input, 32)
  return text || DEFAULT_NICKNAME
}

function sanitizeUrl(input) {
  return sanitizeText(input, 2048)
}

function sanitizeFileId(input) {
  const val = sanitizeText(input, 2048)
  if (!val) return ''
  if (val.indexOf('cloud://') === 0) return val
  return ''
}

function normalizeBool(input) {
  return input === true || input === 1 || input === '1' || input === 'true'
}

function toNonNegativeInt(input, fallback = 0) {
  const n = Number(input)
  if (!Number.isFinite(n)) return Math.max(0, Math.floor(Number(fallback) || 0))
  return Math.max(0, Math.floor(n))
}

function clampLimit(input, fallback = 20) {
  const n = Number(input)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), MAX_LIST_LIMIT)
}

function clampOffset(input) {
  const n = Number(input)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function sanitizeWorkId(input) {
  const raw = sanitizeText(input, 96)
  if (!raw) return ''
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
  if (!safe) return ''
  return safe
}

function userDocId(userKey) {
  const hash = crypto.createHash('md5').update(String(userKey || '')).digest('hex')
  return `u_${hash.slice(0, 24)}`
}

function generateWorkId(userKey) {
  const salt = `${String(userKey || '')}_${now()}_${Math.random()}`
  const hash = crypto.createHash('md5').update(salt).digest('hex')
  return `w_${hash.slice(0, 24)}`
}

function dedupeById(list) {
  const map = {}
  ;(list || []).forEach((it) => {
    if (!it || !it._id) return
    map[it._id] = it
  })
  return Object.keys(map).map((k) => map[k])
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

function pickPreferredUserDoc(list) {
  const docs = dedupeById(list).sort((a, b) => getDocTs(b) - getDocTs(a))
  if (!docs.length) return null

  const withProfile = docs.find((d) => hasProfileData(d))
  if (withProfile) return withProfile

  const withCustom = docs.find((d) => hasCustomIdentity(d))
  if (withCustom) return withCustom

  return docs[0]
}

function isBlankBootstrapDoc(doc) {
  if (!doc || typeof doc !== 'object') return false
  const nickname = String(doc.nickname || '').trim()
  const avatarUrl = String(doc.avatarUrl || '').trim()
  const profile = doc.profile && typeof doc.profile === 'object' ? doc.profile : {}
  const hasProfile = Object.keys(profile).length > 0
  return (nickname === '' || nickname === DEFAULT_NICKNAME) && !avatarUrl && !hasProfile
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
  if (current) return current

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
    return doc
  } catch (e) {
    const fallback = await findByOpenid(openid)
    if (fallback) return fallback

    try {
      const byId = await users.doc(_id).get()
      if (byId && byId.data) return byId.data
    } catch (ignored) {}

    throw e
  }
}

function normalizeOwner(doc = {}, userKey) {
  const profile = doc.profile && typeof doc.profile === 'object' ? doc.profile : {}
  const nickname = sanitizeNickname(doc.nickname || profile.nickname)
  const avatarUrl = sanitizeUrl(doc.avatarUrl || profile.avatarUrl)
  return {
    userKey: String(userKey || ''),
    nickname,
    avatarUrl
  }
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {}
  const out = {}
  const keys = Object.keys(meta).slice(0, 32)
  for (let i = 0; i < keys.length; i += 1) {
    const key = sanitizeText(keys[i], 32)
    if (!key) continue
    const value = meta[keys[i]]
    if (value == null) continue
    if (typeof value === 'string') {
      out[key] = sanitizeText(value, 512)
      continue
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value
      continue
    }
    if (typeof value === 'object') {
      out[key] = sanitizeText(JSON.stringify(value), 1024)
    }
  }
  return out
}

function sanitizeStats(payload = {}, fallback = {}) {
  return {
    likes: toNonNegativeInt(
      payload.likes != null ? payload.likes : payload.likeCount != null ? payload.likeCount : fallback.likes
    ),
    saves: toNonNegativeInt(
      payload.saves != null ? payload.saves : payload.saveCount != null ? payload.saveCount : fallback.saves
    ),
    comments: toNonNegativeInt(
      payload.comments != null
        ? payload.comments
        : payload.commentCount != null
          ? payload.commentCount
          : fallback.comments
    )
  }
}

function sanitizeImages(payload = {}, fallback = {}) {
  const personFileId = sanitizeFileId(
    payload.personFileId || payload.personImageFileId || payload.personImageId || fallback.personFileId
  )
  const clothesFileId = sanitizeFileId(
    payload.clothesFileId || payload.clothesImageFileId || payload.clothesImageId || fallback.clothesFileId
  )
  const resultFileId = sanitizeFileId(
    payload.resultFileId || payload.imageFileId || payload.fileId || payload.fileID || fallback.resultFileId
  )

  const personUrl = sanitizeUrl(payload.personUrl || payload.personImage || fallback.personUrl || personFileId)
  const clothesUrl = sanitizeUrl(payload.clothesUrl || payload.clothesImage || fallback.clothesUrl || clothesFileId)
  const resultUrl = sanitizeUrl(payload.resultUrl || payload.image || payload.coverUrl || fallback.resultUrl || resultFileId)

  return {
    personFileId,
    clothesFileId,
    resultFileId,
    personUrl,
    clothesUrl,
    resultUrl
  }
}

function getStatsFromDoc(doc = {}) {
  const inner = doc.stats && typeof doc.stats === 'object' ? doc.stats : {}
  return sanitizeStats(
    {
      likes: doc.likes,
      saves: doc.saves,
      comments: doc.comments
    },
    {
      likes: inner.likes,
      saves: inner.saves,
      comments: inner.comments
    }
  )
}

function normalizeWorkDoc(doc = {}) {
  const owner = doc.owner && typeof doc.owner === 'object' ? doc.owner : {}
  const images = doc.images && typeof doc.images === 'object' ? doc.images : {}
  const stats = getStatsFromDoc(doc)
  const coverUrl = sanitizeUrl(doc.coverUrl || images.resultUrl || images.resultFileId || '')

  return {
    id: doc._id || '',
    workId: doc._id || '',
    userKey: doc.userKey || '',
    owner: {
      userKey: doc.userKey || owner.userKey || '',
      nickname: sanitizeNickname(owner.nickname || doc.nickname),
      avatarUrl: sanitizeUrl(owner.avatarUrl || doc.avatar)
    },
    nickname: sanitizeNickname(owner.nickname || doc.nickname),
    avatar: sanitizeUrl(owner.avatarUrl || doc.avatar),
    title: sanitizeText(doc.title, 128) || DEFAULT_WORK_TITLE,
    image: coverUrl,
    coverUrl,
    images: {
      personFileId: sanitizeFileId(images.personFileId),
      clothesFileId: sanitizeFileId(images.clothesFileId),
      resultFileId: sanitizeFileId(images.resultFileId),
      personUrl: sanitizeUrl(images.personUrl),
      clothesUrl: sanitizeUrl(images.clothesUrl),
      resultUrl: sanitizeUrl(images.resultUrl)
    },
    likes: stats.likes,
    saves: stats.saves,
    comments: stats.comments,
    stats,
    source: sanitizeText(doc.source, 32),
    published: doc.published === true,
    status: doc.status || ACTIVE_STATUS,
    createdAt: Number(doc.createdAt) || 0,
    updatedAt: Number(doc.updatedAt) || 0,
    publishedAt: Number(doc.publishedAt) || 0,
    deletedAt: Number(doc.deletedAt) || 0,
    meta: doc.meta && typeof doc.meta === 'object' ? doc.meta : {}
  }
}

async function findWorkById(workId) {
  if (!workId) return null
  try {
    const res = await works.doc(workId).get()
    return (res && res.data) || null
  } catch (e) {
    return null
  }
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

function getWorkCloudFileIds(workDoc = {}) {
  const images = workDoc.images && typeof workDoc.images === 'object' ? workDoc.images : {}
  return uniqueStrings([
    sanitizeFileId(images.personFileId),
    sanitizeFileId(images.clothesFileId),
    sanitizeFileId(images.resultFileId)
  ]).filter(Boolean)
}

async function requireOwnedActiveWork(openid, workId) {
  const doc = await findWorkById(workId)
  if (!doc || doc.status === DELETED_STATUS) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'work not found'
    }
  }
  if (String(doc.userKey || '') !== String(openid || '')) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'permission denied'
    }
  }
  return {
    ok: true,
    doc
  }
}

async function doCreateWork(openid, payload = {}) {
  const userDoc = await ensureUser(openid)
  const owner = normalizeOwner(userDoc, openid)
  const ts = now()

  const requestedId = sanitizeWorkId(payload.workId || payload.id)
  const workId = requestedId || generateWorkId(openid)
  const existing = await findWorkById(workId)
  if (existing && String(existing.userKey || '') !== String(openid || '')) {
    return {
      ok: false,
      code: 'CONFLICT',
      message: 'workId already used by another user'
    }
  }

  const prevImages = existing && existing.images ? existing.images : {}
  const images = sanitizeImages(payload, prevImages)
  const hasResult = !!(images.resultFileId || images.resultUrl)
  if (!hasResult) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'resultFileId or resultUrl is required'
    }
  }

  const prevStats = existing ? getStatsFromDoc(existing) : {}
  const stats = existing ? prevStats : { likes: 0, saves: 0, comments: 0 }
  const published = payload.published != null ? normalizeBool(payload.published) : !!(existing && existing.published)
  const title = sanitizeText(payload.title, 128) || (existing && sanitizeText(existing.title, 128)) || DEFAULT_WORK_TITLE
  const source = sanitizeText(payload.source, 32) || (existing && sanitizeText(existing.source, 32)) || 'ai_quick'
  const meta = {
    ...((existing && existing.meta) || {}),
    ...sanitizeMeta(payload.meta || {})
  }

  const doc = {
    userKey: openid,
    owner,
    nickname: owner.nickname,
    avatar: owner.avatarUrl,
    title,
    images,
    coverUrl: images.resultUrl || images.resultFileId || '',
    likes: stats.likes,
    saves: stats.saves,
    comments: stats.comments,
    stats,
    source,
    meta,
    published,
    status: ACTIVE_STATUS,
    createdAt: existing && existing.createdAt ? Number(existing.createdAt) : ts,
    updatedAt: ts,
    publishedAt: published
      ? existing && existing.publishedAt
        ? Number(existing.publishedAt)
        : ts
      : 0,
    deletedAt: 0
  }

  await works.doc(workId).set({ data: doc })
  const saved = await findWorkById(workId)

  return {
    ok: true,
    work: normalizeWorkDoc(saved || { _id: workId, ...doc })
  }
}

async function doListMine(openid, payload = {}) {
  await ensureUser(openid)
  const includeDeleted = normalizeBool(payload.includeDeleted)
  const limit = clampLimit(payload.limit, 20)
  const offset = clampOffset(payload.offset)
  const query = includeDeleted ? { userKey: openid } : { userKey: openid, status: ACTIVE_STATUS }

  const listRes = await works.where(query).orderBy('createdAt', 'desc').skip(offset).limit(limit).get()
  const docs = (listRes && listRes.data) || []
  const totalRes = await works.where(query).count()
  const total = Number((totalRes && totalRes.total) || 0)
  const list = docs.map((d) => normalizeWorkDoc(d))

  return {
    ok: true,
    list,
    total,
    offset,
    limit,
    hasMore: offset + list.length < total
  }
}

async function doListPublic(openid, payload = {}) {
  await ensureUser(openid)
  const limit = clampLimit(payload.limit, 20)
  const offset = clampOffset(payload.offset)
  const query = {
    published: true,
    status: ACTIVE_STATUS
  }

  const listRes = await works.where(query).orderBy('createdAt', 'desc').skip(offset).limit(limit).get()
  const docs = (listRes && listRes.data) || []
  const totalRes = await works.where(query).count()
  const total = Number((totalRes && totalRes.total) || 0)
  const list = docs.map((d) => normalizeWorkDoc(d))

  return {
    ok: true,
    list,
    total,
    offset,
    limit,
    hasMore: offset + list.length < total
  }
}

async function doGetWork(openid, payload = {}) {
  const workId = sanitizeWorkId(payload.workId || payload.id)
  if (!workId) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'workId is required'
    }
  }

  const doc = await findWorkById(workId)
  if (!doc || doc.status === DELETED_STATUS) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'work not found'
    }
  }

  if (!doc.published && String(doc.userKey || '') !== String(openid || '')) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: 'permission denied'
    }
  }

  return {
    ok: true,
    work: normalizeWorkDoc(doc)
  }
}

async function doSetPublish(openid, payload = {}) {
  const workId = sanitizeWorkId(payload.workId || payload.id)
  if (!workId) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'workId is required'
    }
  }

  const owned = await requireOwnedActiveWork(openid, workId)
  if (!owned.ok) return owned

  const published = normalizeBool(payload.published)
  const ts = now()
  await works.doc(workId).update({
    data: {
      published,
      publishedAt: published ? ts : 0,
      updatedAt: ts
    }
  })

  const saved = await findWorkById(workId)
  return {
    ok: true,
    work: normalizeWorkDoc(saved || { ...owned.doc, _id: workId, published, publishedAt: published ? ts : 0, updatedAt: ts })
  }
}

async function removeCollectionByWorkId(collection, workId) {
  const limit = 100
  while (true) {
    const listRes = await collection.where({ workId }).limit(limit).get()
    const docs = (listRes && listRes.data) || []
    if (!docs.length) break

    for (let i = 0; i < docs.length; i += 1) {
      const doc = docs[i]
      if (!doc || !doc._id) continue
      try {
        await collection.doc(doc._id).remove()
      } catch (e) {}
    }

    if (docs.length < limit) break
  }
}

async function cleanupWorkSocialData(workId) {
  await removeCollectionByWorkId(workInteractions, workId)
  await removeCollectionByWorkId(workComments, workId)
}
async function doDeleteWork(openid, payload = {}) {
  const workId = sanitizeWorkId(payload.workId || payload.id)
  if (!workId) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'workId is required'
    }
  }

  const owned = await requireOwnedActiveWork(openid, workId)
  if (!owned.ok) return owned

  const purgeFiles = normalizeBool(payload.purgeFiles)
  const hardDelete = normalizeBool(payload.hardDelete)
  const ts = now()

  if (hardDelete) {
    await works.doc(workId).remove()
  } else {
    await works.doc(workId).update({
      data: {
        status: DELETED_STATUS,
        published: false,
        deletedAt: ts,
        updatedAt: ts
      }
    })
  }

  await cleanupWorkSocialData(workId)

  if (purgeFiles) {
    await safeDeleteCloudFiles(getWorkCloudFileIds(owned.doc))
  }

  return {
    ok: true,
    deletedId: workId,
    hardDelete,
    purgeFiles
  }
}

async function doListByIds(openid, payload = {}) {
  await ensureUser(openid)
  const ids = uniqueStrings(payload.workIds || payload.ids || [])
    .map((id) => sanitizeWorkId(id))
    .filter(Boolean)
    .slice(0, MAX_LIST_LIMIT)

  if (!ids.length) {
    return {
      ok: true,
      list: []
    }
  }

  const list = []
  for (let i = 0; i < ids.length; i += 1) {
    const workId = ids[i]
    const doc = await findWorkById(workId)
    if (!doc || doc.status === DELETED_STATUS) continue
    if (!doc.published && String(doc.userKey || '') !== String(openid || '')) continue
    list.push(normalizeWorkDoc(doc))
  }

  return {
    ok: true,
    list
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
    const action = String(event.action || 'listMine')

    if (action === 'createWork' || action === 'saveWork' || action === 'upsertWork') {
      const result = await doCreateWork(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'listMine') {
      const result = await doListMine(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'listPublic') {
      const result = await doListPublic(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'listByIds') {
      const result = await doListByIds(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'getWork') {
      const result = await doGetWork(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'setPublish') {
      const result = await doSetPublish(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'updateStats') {
      return {
        ok: false,
        code: 'DISABLED',
        message: 'updateStats is disabled; use works_social_v1',
        openid,
        userKey: openid
      }
    }

    if (action === 'deleteWork') {
      const result = await doDeleteWork(openid, event)
      return { ...result, openid, userKey: openid }
    }

    return {
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: `unknown action: ${action}`,
      openid,
      userKey: openid
    }
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
