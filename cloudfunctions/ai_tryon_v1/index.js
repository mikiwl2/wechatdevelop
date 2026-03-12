const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const https = require('https')
const http = require('http')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const ACTION = 'ChangeClothes'
const VERSION = '2022-12-29'
const ENDPOINT = 'aiart.tencentcloudapi.com'
const SERVICE = 'aiart'
const ALGORITHM = 'TC3-HMAC-SHA256'
const DEFAULT_REGION =
  process.env.AIART_REGION ||
  process.env.REGION ||
  process.env.TC_REGION ||
  'ap-guangzhou'
const VALID_CLOTHES_TYPES = ['Upper-body', 'Lower-body', 'Dress']
const MAX_REDIRECT = 3

function now() {
  return Date.now()
}

function sanitizeText(input, maxLen) {
  const text = String(input || '').trim()
  if (!text) return ''
  return text.slice(0, maxLen)
}

function readEnv(keys = [], maxLen = 256) {
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i]
    const val = sanitizeText(process.env[key], maxLen)
    if (val) return val
  }
  return ''
}

function sanitizeUrl(input) {
  const text = sanitizeText(input, 2048)
  if (!/^https?:\/\//i.test(text)) return ''
  return text
}

function sanitizeCloudPath(input) {
  const text = sanitizeText(input, 512).replace(/\\/g, '/')
  if (!text) return ''
  if (text.indexOf('..') !== -1) return ''
  if (text.startsWith('/')) return ''
  return text
}

function sanitizeClothesType(input) {
  const val = sanitizeText(input, 32)
  if (!val) return ''
  if (VALID_CLOTHES_TYPES.indexOf(val) === -1) return ''
  return val
}

function normalizeBool(input, fallback = false) {
  if (input === true || input === 1 || input === '1' || input === 'true') return true
  if (input === false || input === 0 || input === '0' || input === 'false') return false
  return fallback
}

function sha256(msg, encoding = 'hex') {
  return crypto.createHash('sha256').update(msg).digest(encoding)
}

function hmacSha256(key, msg, encoding) {
  return crypto.createHmac('sha256', key).update(msg).digest(encoding)
}

function getDate(timestampSec) {
  const date = new Date(timestampSec * 1000)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function requestTencentApi(payload = {}, region = DEFAULT_REGION, secretId = '', secretKey = '') {
  const timestamp = Math.floor(now() / 1000)
  const date = getDate(timestamp)
  const payloadStr = JSON.stringify(payload)

  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${ENDPOINT}\nx-tc-action:${ACTION.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'

  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(payloadStr)].join('\n')

  const credentialScope = `${date}/${SERVICE}/tc3_request`
  const stringToSign = [ALGORITHM, String(timestamp), credentialScope, sha256(canonicalRequest)].join('\n')

  const secretDate = hmacSha256(`TC3${secretKey}`, date)
  const secretService = hmacSha256(secretDate, SERVICE)
  const secretSigning = hmacSha256(secretService, 'tc3_request')
  const signature = hmacSha256(secretSigning, stringToSign, 'hex')

  const authorization = `${ALGORITHM} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const requestOptions = {
    hostname: ENDPOINT,
    method: 'POST',
    path: '/',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: ENDPOINT,
      'X-TC-Action': ACTION,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': VERSION,
      'X-TC-Region': region
    },
    timeout: 30000
  }

  return new Promise((resolve, reject) => {
    const req = https.request(requestOptions, (res) => {
      const chunks = []

      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        let parsed = null
        try {
          parsed = JSON.parse(raw)
        } catch (e) {
          reject(new Error(`AI API returned non-JSON: ${raw.slice(0, 180)}`))
          return
        }

        resolve({
          statusCode: res.statusCode || 0,
          data: parsed
        })
      })
    })

    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy(new Error('AI API request timeout'))
    })

    req.write(payloadStr)
    req.end()
  })
}

function resolveRedirectUrl(baseUrl, location) {
  try {
    return new URL(location, baseUrl).toString()
  } catch (e) {
    return ''
  }
}

function downloadBinaryByUrl(url, redirectDepth = 0) {
  const cleanUrl = sanitizeUrl(url)
  if (!cleanUrl) {
    return Promise.reject(new Error('imageUrl is invalid'))
  }

  const client = /^https:/i.test(cleanUrl) ? https : http

  return new Promise((resolve, reject) => {
    const req = client.get(cleanUrl, (res) => {
      const statusCode = Number(res.statusCode || 0)

      if ((statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308) &&
        res.headers && res.headers.location) {
        if (redirectDepth >= MAX_REDIRECT) {
          reject(new Error('too many redirects when downloading image'))
          res.resume()
          return
        }

        const nextUrl = resolveRedirectUrl(cleanUrl, String(res.headers.location || ''))
        res.resume()

        if (!nextUrl) {
          reject(new Error('redirect location is invalid'))
          return
        }

        downloadBinaryByUrl(nextUrl, redirectDepth + 1).then(resolve).catch(reject)
        return
      }

      if (statusCode < 200 || statusCode >= 300) {
        reject(new Error(`download failed, status=${statusCode}`))
        res.resume()
        return
      }

      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if (!buffer.length) {
          reject(new Error('downloaded image is empty'))
          return
        }
        resolve(buffer)
      })
    })

    req.on('error', (err) => reject(err))
    req.setTimeout(30000, () => {
      req.destroy(new Error('download image timeout'))
    })
  })
}

async function doSaveResultToCloud(event = {}) {
  const imageUrl = sanitizeUrl(event.imageUrl || event.ImageUrl)
  const cloudPath = sanitizeCloudPath(event.cloudPath || event.CloudPath)

  if (!imageUrl) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'imageUrl is required and must be http(s) url'
    }
  }

  if (!cloudPath) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'cloudPath is required and must be valid'
    }
  }

  try {
    const fileContent = await downloadBinaryByUrl(imageUrl)
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent
    })

    return {
      ok: true,
      fileId: (uploadRes && uploadRes.fileID) || ''
    }
  } catch (error) {
    return {
      ok: false,
      code: 'SAVE_RESULT_FAILED',
      message: error && error.message ? error.message : 'save result image to cloud failed'
    }
  }
}

async function doChangeClothes(event = {}) {
  const modelUrl = sanitizeUrl(event.modelUrl || event.ModelUrl)
  const clothesUrl = sanitizeUrl(event.clothesUrl || event.ClothesUrl)
  const clothesType = sanitizeClothesType(event.clothesType || event.ClothesType)
  const rspImgType = sanitizeText(event.rspImgType || event.RspImgType, 16) || 'url'
  const region = sanitizeText(event.region || event.Region, 32) || DEFAULT_REGION

  if (!modelUrl) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'modelUrl is required and must be http(s) url'
    }
  }

  if (!clothesUrl) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'clothesUrl is required and must be http(s) url'
    }
  }

  if (!clothesType) {
    return {
      ok: false,
      code: 'INVALID_PARAM',
      message: 'clothesType must be one of Upper-body / Lower-body / Dress'
    }
  }

  const secretId = readEnv(['SECRET_ID', 'AIART_SECRET_ID', 'TC_SECRET_ID'], 128)
  const secretKey = readEnv(['SECRET_KEY', 'AIART_SECRET_KEY', 'TC_SECRET_KEY'], 128)

  if (!secretId || !secretKey) {
    return {
      ok: false,
      code: 'SECRET_MISSING',
      message: 'missing SECRET_ID/SECRET_KEY (or AIART_SECRET_ID/AIART_SECRET_KEY) in cloud function env'
    }
  }

  const payload = {
    ModelUrl: modelUrl,
    ClothesUrl: clothesUrl,
    ClothesType: clothesType,
    RspImgType: rspImgType === 'base64' ? 'base64' : 'url'
  }

  if (event.logoAdd != null || event.LogoAdd != null) {
    payload.LogoAdd = normalizeBool(event.logoAdd != null ? event.logoAdd : event.LogoAdd, true) ? 1 : 0
  }

  const logoParam = event.logoParam || event.LogoParam
  if (logoParam && typeof logoParam === 'object') {
    payload.LogoParam = logoParam
  }

  try {
    const apiRes = await requestTencentApi(payload, region, secretId, secretKey)
    const body = (apiRes && apiRes.data && apiRes.data.Response) || {}

    if (body.Error) {
      return {
        ok: false,
        code: body.Error.Code || 'AI_API_ERROR',
        message: body.Error.Message || 'AI API call failed',
        requestId: body.RequestId || '',
        statusCode: apiRes.statusCode || 0
      }
    }

    const resultImage = sanitizeText(body.ResultImage, 5000)
    if (!resultImage) {
      return {
        ok: false,
        code: 'EMPTY_RESULT',
        message: 'AI API returned empty ResultImage',
        requestId: body.RequestId || '',
        statusCode: apiRes.statusCode || 0
      }
    }

    return {
      ok: true,
      resultImage,
      requestId: body.RequestId || '',
      rspImgType: payload.RspImgType,
      statusCode: apiRes.statusCode || 200
    }
  } catch (error) {
    return {
      ok: false,
      code: 'REQUEST_FAILED',
      message: error && error.message ? error.message : 'request tencent ai api failed'
    }
  }
}

exports.main = async (event = {}) => {
  try {
    const action = String(event.action || 'changeClothes')

    if (action === 'changeClothes') {
      return doChangeClothes(event)
    }

    if (action === 'saveResultToCloud') {
      return doSaveResultToCloud(event)
    }

    return {
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: `unknown action: ${action}`
    }
  } catch (error) {
    return {
      ok: false,
      code: 'SERVER_ERROR',
      message: error && error.message ? error.message : 'cloud function failed'
    }
  }
}