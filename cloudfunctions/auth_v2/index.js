const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const users = db.collection('users')

function now() {
  return Date.now()
}

function sanitizeText(input, maxLen) {
  const text = String(input || '').trim()
  if (!text) return ''
  return text.slice(0, maxLen)
}

function sanitizeNickname(nickname) {
  const text = sanitizeText(nickname, 32)
  return text || 'wx_user'
}

function sanitizeAvatar(avatarUrl) {
  return sanitizeText(avatarUrl, 1024)
}

function sanitizeProfile(profile) {
  const p = profile && typeof profile === 'object' ? profile : {}
  const styleTagsRaw = Array.isArray(p.styleTags) ? p.styleTags : []
  const styleTags = styleTagsRaw
    .map((it) => {
      if (!it) return null
      if (typeof it === 'string') return { label: sanitizeText(it, 24), selected: false }
      return {
        label: sanitizeText(it.label, 24),
        selected: !!it.selected
      }
    })
    .filter((it) => it && it.label)

  return {
    nickname: sanitizeNickname(p.nickname),
    avatarUrl: sanitizeAvatar(p.avatarUrl),
    gender: sanitizeText(p.gender, 16),
    height: Number(p.height) || 0,
    weight: sanitizeText(p.weight, 16),
    bust: sanitizeText(p.bust, 16),
    waist: sanitizeText(p.waist, 16),
    hip: sanitizeText(p.hip, 16),
    bodyType: sanitizeText(p.bodyType, 24),
    measurementsOpen: p.measurementsOpen !== false,
    extendedOpen: !!p.extendedOpen,
    styleTags,
    skinTone: sanitizeText(p.skinTone, 16),
    skinTemp: sanitizeText(p.skinTemp, 16),
    shoeSizeIndex: Number(p.shoeSizeIndex) || 0,
    sizeTop: sanitizeText(p.sizeTop, 16),
    sizePants: sanitizeText(p.sizePants, 16),
    sizeShoePref: sanitizeText(p.sizeShoePref, 16)
  }
}

function normalizeUser(doc = {}, userKey) {
  return {
    userKey: userKey,
    nickname: doc.nickname || 'wx_user',
    avatarUrl: doc.avatarUrl || '',
    createdAt: doc.createdAt || 0,
    updatedAt: doc.updatedAt || 0,
    lastLoginAt: doc.lastLoginAt || 0
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
  return (!!nickname && nickname !== 'wx_user') || !!avatarUrl
}

function dedupeById(list) {
  const map = {}
  ;(list || []).forEach((it) => {
    if (!it || !it._id) return
    map[it._id] = it
  })
  return Object.keys(map).map((k) => map[k])
}

function pickPreferredDoc(list) {
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

function isBlankBootstrapDoc(doc) {
  if (!doc || typeof doc !== 'object') return false
  const nickname = String(doc.nickname || '').trim()
  const avatarUrl = String(doc.avatarUrl || '').trim()
  const profile = doc.profile && typeof doc.profile === 'object' ? doc.profile : {}
  const hasProfile = Object.keys(profile).length > 0
  return (nickname === '' || nickname === 'wx_user') && !avatarUrl && !hasProfile
}

async function cleanupDuplicateDocs(primaryId, list) {
  if (!primaryId) return
  const docs = dedupeById(list)
  const stale = docs.filter((d) => d && d._id && d._id !== primaryId && isBlankBootstrapDoc(d))
  for (let i = 0; i < stale.length; i += 1) {
    const doc = stale[i]
    try {
      await users.doc(doc._id).remove()
    } catch (e) {}
  }
}
async function queryByUserKey(userKey) {
  const res = await users.where({ userKey }).limit(20).get()
  return (res && res.data) || []
}

async function queryByOpenid(openid) {
  const res = await users.where({ _openid: openid }).limit(20).get()
  return (res && res.data) || []
}

async function findByOpenid(openid) {
  const byKeyList = await queryByUserKey(openid)
  const byOpenidList = await queryByOpenid(openid)
  const candidates = [...(byKeyList || []), ...(byOpenidList || [])]
  const picked = pickPreferredDoc(candidates)
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

  await cleanupDuplicateDocs(primary._id, candidates)
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
    nickname: 'wx_user',
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

async function doLogin(openid) {
  const { doc: current, isNew } = await ensureUser(openid)
  const ts = now()

  if (current._id) {
    await users.doc(current._id).update({
      data: {
        userKey: openid,
        lastLoginAt: ts,
        updatedAt: ts
      }
    })
  }

  return {
    ok: true,
    isNew,
    user: normalizeUser({ ...current, userKey: openid, lastLoginAt: ts, updatedAt: ts }, openid)
  }
}

async function doSyncProfile(openid, payload = {}) {
  const nickname = sanitizeNickname(payload.nickname)
  const avatarUrl = sanitizeAvatar(payload.avatarUrl)
  const ts = now()

  const { doc: current } = await ensureUser(openid)
  const currentProfile = (current && current.profile) || {}
  const nextProfile = { ...currentProfile, nickname, avatarUrl }

  await users.doc(current._id).update({
    data: {
      userKey: openid,
      nickname,
      avatarUrl,
      profile: nextProfile,
      updatedAt: ts
    }
  })

  return {
    ok: true,
    user: normalizeUser({ ...current, userKey: openid, nickname, avatarUrl, updatedAt: ts }, openid),
    profile: nextProfile
  }
}

async function doGetProfile(openid) {
  const { doc: current } = await ensureUser(openid)
  return {
    ok: true,
    user: normalizeUser(current, openid),
    profile: (current && current.profile) || {}
  }
}

async function doSaveProfile(openid, payload = {}) {
  const incoming = sanitizeProfile(payload.profile)
  const ts = now()
  const { doc: current } = await ensureUser(openid)

  const nickname = sanitizeNickname(incoming.nickname || current.nickname)
  const avatarUrl = sanitizeAvatar(incoming.avatarUrl || current.avatarUrl)
  const profile = {
    ...(current.profile || {}),
    ...incoming,
    nickname,
    avatarUrl
  }

  await users.doc(current._id).update({
    data: {
      userKey: openid,
      nickname,
      avatarUrl,
      profile,
      updatedAt: ts
    }
  })

  return {
    ok: true,
    user: normalizeUser({ ...current, userKey: openid, nickname, avatarUrl, updatedAt: ts }, openid),
    profile
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
    const action = String(event.action || 'login')

    if (action === 'syncProfile') {
      const result = await doSyncProfile(openid, event)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'getProfile') {
      const result = await doGetProfile(openid)
      return { ...result, openid, userKey: openid }
    }

    if (action === 'saveProfile') {
      const result = await doSaveProfile(openid, event)
      return { ...result, openid, userKey: openid }
    }

    const result = await doLogin(openid)
    return { ...result, openid, userKey: openid }
  } catch (error) {
    return {
      ok: false,
      code: 'SERVER_ERROR',
      message: error && error.message ? error.message : 'cloud function failed'
    }
  }
}

