const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const users = db.collection('users')
const _ = db.command

function now() {
  return Date.now()
}

function sanitizeNickname(nickname) {
  const text = String(nickname || '').trim()
  if (!text) return '微信用户'
  return text.slice(0, 32)
}

function sanitizeAvatar(avatarUrl) {
  const text = String(avatarUrl || '').trim()
  return text.slice(0, 1024)
}

function normalizeUser(doc = {}, openid) {
  return {
    userKey: openid,
    nickname: doc.nickname || '微信用户',
    avatarUrl: doc.avatarUrl || '',
    createdAt: doc.createdAt || 0,
    updatedAt: doc.updatedAt || 0,
    lastLoginAt: doc.lastLoginAt || 0
  }
}

async function findByOpenid(openid) {
  const res = await users.where({ _openid: openid }).limit(1).get()
  const list = (res && res.data) || []
  return list[0] || null
}

async function doLogin(openid) {
  const current = await findByOpenid(openid)
  const ts = now()

  if (!current) {
    const doc = {
      nickname: '微信用户',
      avatarUrl: '',
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: ts
    }
    await users.add({ data: doc })
    return {
      ok: true,
      isNew: true,
      user: normalizeUser(doc, openid)
    }
  }

  await users.doc(current._id).update({
    data: {
      lastLoginAt: ts,
      updatedAt: ts
    }
  })

  return {
    ok: true,
    isNew: false,
    user: normalizeUser({ ...current, lastLoginAt: ts, updatedAt: ts }, openid)
  }
}

async function doSyncProfile(openid, payload = {}) {
  const nickname = sanitizeNickname(payload.nickname)
  const avatarUrl = sanitizeAvatar(payload.avatarUrl)
  const ts = now()

  const current = await findByOpenid(openid)
  if (!current) {
    const doc = {
      nickname,
      avatarUrl,
      createdAt: ts,
      updatedAt: ts,
      lastLoginAt: ts
    }
    await users.add({ data: doc })
    return {
      ok: true,
      user: normalizeUser(doc, openid)
    }
  }

  await users.doc(current._id).update({
    data: {
      nickname,
      avatarUrl,
      updatedAt: ts
    }
  })

  return {
    ok: true,
    user: normalizeUser({ ...current, nickname, avatarUrl, updatedAt: ts }, openid)
  }
}

exports.main = async (event = {}, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  if (!openid) {
    return {
      ok: false,
      code: 'NO_OPENID',
      message: '无法获取当前用户OPENID'
    }
  }

  try {
    const action = String(event.action || 'login')

    if (action === 'syncProfile') {
      const result = await doSyncProfile(openid, event)
      return {
        ...result,
        openid
      }
    }

    const result = await doLogin(openid)
    return {
      ...result,
      openid
    }
  } catch (error) {
    return {
      ok: false,
      code: 'SERVER_ERROR',
      message: error && error.message ? error.message : '云函数执行失败'
    }
  }
}