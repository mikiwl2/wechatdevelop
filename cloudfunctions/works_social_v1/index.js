const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const users = db.collection('users')
const works = db.collection('works')
const interactions = db.collection('work_interactions')
const comments = db.collection('work_comments')

const ACTIVE_STATUS = 'active'
const DELETED_STATUS = 'deleted'
const DEFAULT_NICKNAME = 'wx_user'
const MAX_LIMIT = 100

function now() {
  return Date.now()
}

function sanitizeText(input, maxLen) {
  const text = String(input || '').trim()
  if (!text) return ''
  return text.slice(0, maxLen)
}

function sanitizeWorkId(input) {
  const raw = sanitizeText(input, 96)
  if (!raw) return ''
  return raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
}

function sanitizeContent(input) {
  return sanitizeText(input, 500)
}

function normalizeBool(input) {
  return input === true || input === 1 || input === '1' || input === 'true'
}

function clampLimit(input, fallback) {
  const n = Number(input)
  if (!Number.isFinite(n) || n <= 0) return fallback || 20
  return Math.min(Math.floor(n), MAX_LIMIT)
}

function clampOffset(input) {
  const n = Number(input)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function toNonNegativeInt(input) {
  const n = Number(input)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

function uniqueStrings(list) {
  const map = {}
  ;(list || []).forEach((it) => {
    const key = sanitizeText(it, 128)
    if (!key) return
    map[key] = true
  })
  return Object.keys(map)
}

function interactionDocId(userKey, workId) {
  const hash = crypto.createHash('md5').update(String(userKey || '') + '_' + String(workId || '')).digest('hex')
  return 'wi_' + hash.slice(0, 24)
}

function userDocId(userKey) {
  const hash = crypto.createHash('md5').update(String(userKey || '')).digest('hex')
  return 'u_' + hash.slice(0, 24)
}

function normalizeCommentDoc(doc) {
  const d = doc || {}
  return {
    id: d._id || '',
    workId: d.workId || '',
    userKey: d.userKey || '',
    nickname: d.nickname || DEFAULT_NICKNAME,
    avatarUrl: d.avatarUrl || '',
    content: d.content || '',
    status: d.status || ACTIVE_STATUS,
    createdAt: Number(d.createdAt) || 0,
    updatedAt: Number(d.updatedAt) || 0
  }
}

function normalizeInteractionDoc(doc, workId) {
  const d = doc || {}
  return {
    id: d._id || '',
    workId: workId || d.workId || '',
    userKey: d.userKey || '',
    liked: !!d.liked,
    saved: !!d.saved,
    createdAt: Number(d.createdAt) || 0,
    updatedAt: Number(d.updatedAt) || 0
  }
}

function normalizeWorkStats(doc) {
  const d = doc || {}
  const stats = d.stats && typeof d.stats === 'object' ? d.stats : {}
  return {
    likes: toNonNegativeInt(d.likes != null ? d.likes : stats.likes),
    saves: toNonNegativeInt(d.saves != null ? d.saves : stats.saves),
    comments: toNonNegativeInt(d.comments != null ? d.comments : stats.comments)
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
  const candidates = (byKeyList || []).concat(byOpenidList || [])
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
      primary = Object.assign({}, picked, { userKey: openid, updatedAt: ts })
    } catch (e) {}
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

async function findWorkById(workId) {
  if (!workId) return null
  try {
    const res = await works.doc(workId).get()
    return (res && res.data) || null
  } catch (e) {
    return null
  }
}

async function requireReadableWork(openid, workId) {
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
    doc
  }
}

async function getInteractionByDocId(docId) {
  if (!docId) return null
  try {
    const res = await interactions.doc(docId).get()
    return (res && res.data) || null
  } catch (e) {
    return null
  }
}

async function clampWorkCounters(workId) {
  const work = await findWorkById(workId)
  if (!work || work.status === DELETED_STATUS) return null

  const stats = normalizeWorkStats(work)
  const currentStats = work.stats && typeof work.stats === 'object' ? work.stats : {}
  const needPatch =
    Number(work.likes) !== stats.likes ||
    Number(work.saves) !== stats.saves ||
    Number(work.comments) !== stats.comments ||
    Number(currentStats.likes) !== stats.likes ||
    Number(currentStats.saves) !== stats.saves ||
    Number(currentStats.comments) !== stats.comments

  if (needPatch) {
    await works.doc(workId).update({
      data: {
        likes: stats.likes,
        saves: stats.saves,
        comments: stats.comments,
        stats: {
          likes: stats.likes,
          saves: stats.saves,
          comments: stats.comments
        },
        updatedAt: now()
      }
    })
    return findWorkById(workId)
  }

  return work
}

async function updateWorkCounters(workId) {
  const likeCountRes = await interactions.where({ workId, liked: true }).count()
  const saveCountRes = await interactions.where({ workId, saved: true }).count()
  const commentCountRes = await comments.where({ workId, status: ACTIVE_STATUS }).count()

  const stats = {
    likes: toNonNegativeInt((likeCountRes && likeCountRes.total) || 0),
    saves: toNonNegativeInt((saveCountRes && saveCountRes.total) || 0),
    comments: toNonNegativeInt((commentCountRes && commentCountRes.total) || 0)
  }

  try {
    await works.doc(workId).update({
      data: {
        likes: stats.likes,
        saves: stats.saves,
        comments: stats.comments,
        stats: {
          likes: stats.likes,
          saves: stats.saves,
          comments: stats.comments
        },
        updatedAt: now()
      }
    })
  } catch (e) {}

  return clampWorkCounters(workId)
}

async function doToggleInteraction(openid, payload, field) {
  const body = payload || {}
  const workId = sanitizeWorkId(body.workId || body.id)
  if (!workId) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'workId is required'
    }
  }

  const readable = await requireReadableWork(openid, workId)
  if (!readable.ok) return readable

  const docId = interactionDocId(openid, workId)
  const existing = await getInteractionByDocId(docId)
  const prevLiked = !!(existing && existing.liked)
  const prevSaved = !!(existing && existing.saved)

  const hasExplicit = body.value != null
  const explicitValue = hasExplicit ? normalizeBool(body.value) : null

  const nextLiked = field === 'liked' ? (hasExplicit ? explicitValue : !prevLiked) : prevLiked
  const nextSaved = field === 'saved' ? (hasExplicit ? explicitValue : !prevSaved) : prevSaved

  const ts = now()
  const writeDoc = {
    userKey: openid,
    workId,
    liked: nextLiked,
    saved: nextSaved,
    createdAt: existing && existing.createdAt ? Number(existing.createdAt) : ts,
    updatedAt: ts
  }

  let interaction = null
  if (!nextLiked && !nextSaved) {
    if (existing && existing._id) {
      try {
        await interactions.doc(docId).remove()
      } catch (e) {}
    }

    interaction = {
      id: docId,
      workId,
      userKey: openid,
      liked: false,
      saved: false,
      createdAt: existing && existing.createdAt ? Number(existing.createdAt) : 0,
      updatedAt: ts
    }
  } else {
    await interactions.doc(docId).set({ data: writeDoc })
    interaction = normalizeInteractionDoc(Object.assign({ _id: docId }, writeDoc), workId)
  }

  const latestWork = await updateWorkCounters(workId)
  const stats = normalizeWorkStats(latestWork || readable.doc || {})

  return {
    ok: true,
    interaction,
    stats
  }
}

async function doGetInteraction(openid, payload) {
  const body = payload || {}
  const workId = sanitizeWorkId(body.workId || body.id)
  if (!workId) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'workId is required'
    }
  }

  const readable = await requireReadableWork(openid, workId)
  if (!readable.ok) return readable

  const docId = interactionDocId(openid, workId)
  const existing = await getInteractionByDocId(docId)
  const interaction = existing
    ? normalizeInteractionDoc(existing, workId)
    : {
        id: docId,
        workId,
        userKey: openid,
        liked: false,
        saved: false,
        createdAt: 0,
        updatedAt: 0
      }

  return {
    ok: true,
    interaction,
    stats: normalizeWorkStats(readable.doc || {})
  }
}

async function doBatchGetInteractions(openid, payload) {
  const body = payload || {}
  const ids = uniqueStrings(body.workIds || body.ids || []).map((id) => sanitizeWorkId(id)).filter(Boolean)
  const workIds = ids.slice(0, MAX_LIMIT)

  if (!workIds.length) {
    return {
      ok: true,
      map: {}
    }
  }

  const res = await interactions.where({ userKey: openid, workId: _.in(workIds) }).limit(MAX_LIMIT).get()
  const docs = (res && res.data) || []
  const map = {}

  for (let i = 0; i < workIds.length; i += 1) {
    const workId = workIds[i]
    map[workId] = {
      liked: false,
      saved: false,
      updatedAt: 0
    }
  }

  docs.forEach((doc) => {
    const workId = sanitizeWorkId(doc.workId)
    if (!workId || !map[workId]) return
    map[workId] = {
      liked: !!doc.liked,
      saved: !!doc.saved,
      updatedAt: Number(doc.updatedAt) || 0
    }
  })

  return {
    ok: true,
    map
  }
}

async function listAllInteractionsByFilteredOffset(openid, offset, limit) {
  const pageSize = Math.min(MAX_LIMIT, Math.max(limit, 20))
  let rawSkip = 0
  let filteredSeen = 0
  const list = []

  while (list.length < limit) {
    const pageRes = await interactions.where({ userKey: openid }).orderBy('updatedAt', 'desc').skip(rawSkip).limit(pageSize).get()
    const docs = (pageRes && pageRes.data) || []
    if (!docs.length) break

    for (let i = 0; i < docs.length; i += 1) {
      const doc = docs[i]
      const valid = !!(doc && (doc.liked || doc.saved))
      if (!valid) continue

      if (filteredSeen < offset) {
        filteredSeen += 1
        continue
      }

      if (list.length < limit) {
        list.push(normalizeInteractionDoc(doc))
      }
      filteredSeen += 1

      if (list.length >= limit) break
    }

    rawSkip += docs.length
    if (docs.length < pageSize) break
  }

  return list
}

async function countAllInteractions(openid) {
  const likedRes = await interactions.where({ userKey: openid, liked: true }).count()
  const savedRes = await interactions.where({ userKey: openid, saved: true }).count()
  const bothRes = await interactions.where({ userKey: openid, liked: true, saved: true }).count()

  const liked = Number((likedRes && likedRes.total) || 0)
  const saved = Number((savedRes && savedRes.total) || 0)
  const both = Number((bothRes && bothRes.total) || 0)
  return Math.max(0, liked + saved - both)
}

async function doListMyInteractions(openid, payload) {
  const body = payload || {}
  const type = sanitizeText(body.type, 16) || 'all'
  const limit = clampLimit(body.limit, 100)
  const offset = clampOffset(body.offset)

  let list = []
  let total = 0

  if (type === 'all') {
    list = await listAllInteractionsByFilteredOffset(openid, offset, limit)
    total = await countAllInteractions(openid)
  } else {
    const query = { userKey: openid }
    if (type === 'liked') query.liked = true
    if (type === 'saved') query.saved = true

    const listRes = await interactions.where(query).orderBy('updatedAt', 'desc').skip(offset).limit(limit).get()
    const docs = (listRes && listRes.data) || []
    const totalRes = await interactions.where(query).count()
    total = Number((totalRes && totalRes.total) || 0)
    list = docs.map((doc) => normalizeInteractionDoc(doc))
  }

  const likedWorkIds = list.filter((it) => it.liked).map((it) => it.workId)
  const savedWorkIds = list.filter((it) => it.saved).map((it) => it.workId)

  return {
    ok: true,
    list,
    likedWorkIds: uniqueStrings(likedWorkIds),
    savedWorkIds: uniqueStrings(savedWorkIds),
    total,
    offset,
    limit,
    hasMore: offset + list.length < total
  }
}

async function doAddComment(openid, payload) {
  const body = payload || {}
  const workId = sanitizeWorkId(body.workId || body.id)
  const content = sanitizeContent(body.content || body.text)
  if (!workId) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'workId is required'
    }
  }
  if (!content) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'content is required'
    }
  }

  const readable = await requireReadableWork(openid, workId)
  if (!readable.ok) return readable

  const userDoc = await ensureUser(openid)
  const profile = userDoc && userDoc.profile && typeof userDoc.profile === 'object' ? userDoc.profile : {}
  const nickname = sanitizeText(profile.nickname || userDoc.nickname, 32) || DEFAULT_NICKNAME
  const avatarUrl = sanitizeText(profile.avatarUrl || userDoc.avatarUrl, 2048)

  const ts = now()
  const commentId = 'wc_' + ts + '_' + Math.floor(Math.random() * 100000)

  const commentDoc = {
    _id: commentId,
    workId,
    userKey: openid,
    nickname,
    avatarUrl,
    content,
    status: ACTIVE_STATUS,
    createdAt: ts,
    updatedAt: ts
  }

  await comments.add({ data: commentDoc })
  const latestWork = await updateWorkCounters(workId)

  return {
    ok: true,
    comment: normalizeCommentDoc(commentDoc),
    stats: normalizeWorkStats(latestWork || readable.doc || {})
  }
}

async function doListComments(openid, payload) {
  const body = payload || {}
  const workId = sanitizeWorkId(body.workId || body.id)
  if (!workId) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'workId is required'
    }
  }

  const readable = await requireReadableWork(openid, workId)
  if (!readable.ok) return readable

  const limit = clampLimit(body.limit, 50)
  const offset = clampOffset(body.offset)
  const query = {
    workId,
    status: ACTIVE_STATUS
  }

  const listRes = await comments.where(query).orderBy('createdAt', 'desc').skip(offset).limit(limit).get()
  const docs = (listRes && listRes.data) || []
  const totalRes = await comments.where(query).count()
  const total = Number((totalRes && totalRes.total) || 0)

  return {
    ok: true,
    list: docs.map((doc) => normalizeCommentDoc(doc)),
    total,
    offset,
    limit,
    hasMore: offset + docs.length < total
  }
}

exports.main = async (event) => {
  const body = event || {}
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
    const action = String(body.action || 'batchGetInteractions')

    if (action === 'toggleLike') {
      const result = await doToggleInteraction(openid, body, 'liked')
      return Object.assign({}, result, { openid, userKey: openid })
    }

    if (action === 'toggleSave') {
      const result = await doToggleInteraction(openid, body, 'saved')
      return Object.assign({}, result, { openid, userKey: openid })
    }

    if (action === 'getInteraction') {
      const result = await doGetInteraction(openid, body)
      return Object.assign({}, result, { openid, userKey: openid })
    }

    if (action === 'batchGetInteractions') {
      const result = await doBatchGetInteractions(openid, body)
      return Object.assign({}, result, { openid, userKey: openid })
    }

    if (action === 'listMyInteractions') {
      const result = await doListMyInteractions(openid, body)
      return Object.assign({}, result, { openid, userKey: openid })
    }

    if (action === 'addComment') {
      const result = await doAddComment(openid, body)
      return Object.assign({}, result, { openid, userKey: openid })
    }

    if (action === 'listComments') {
      const result = await doListComments(openid, body)
      return Object.assign({}, result, { openid, userKey: openid })
    }

    return {
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: 'unknown action: ' + action,
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