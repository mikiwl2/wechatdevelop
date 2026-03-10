# works_v1 云函数接口说明（TryonList）

## 1. 云函数位置
- `cloudfunctions/works_v1/index.js`
- `cloudfunctions/works_v1/package.json`

## 2. 身份与隔离原则
- 统一使用 `OPENID` 作为 `userKey`。
- 写接口（发布、删除、更新计数）都做“仅作品本人可操作”校验。
- 未发布作品只能本人读取，其他用户会收到 `FORBIDDEN`。

## 3. 已支持 action

### 3.1 createWork / saveWork / upsertWork
创建或更新一条试衣作品（按 `workId` 幂等 upsert）。

请求示例：
```js
wx.cloud.callFunction({
  name: 'works_v1',
  data: {
    action: 'createWork',
    workId: 'w_xxx_optional',
    title: '我的试衣作品',
    published: false,
    personFileId: 'cloud://.../works/uid/xxx/person.jpg',
    clothesFileId: 'cloud://.../works/uid/xxx/clothes.jpg',
    resultFileId: 'cloud://.../works/uid/xxx/result.jpg',
    resultUrl: 'cloud://.../works/uid/xxx/result.jpg',
    meta: { source: 'ai_quick' }
  }
})
```

### 3.2 listMine
读取当前登录用户自己的作品列表。

请求示例：
```js
wx.cloud.callFunction({
  name: 'works_v1',
  data: {
    action: 'listMine',
    limit: 20,
    offset: 0,
    includeDeleted: false
  }
})
```

### 3.3 listPublic
读取公开作品流（用于 AI 衣橱页）。

请求示例：
```js
wx.cloud.callFunction({
  name: 'works_v1',
  data: {
    action: 'listPublic',
    limit: 20,
    offset: 0
  }
})
```

### 3.4 getWork
读取单条作品详情。

请求示例：
```js
wx.cloud.callFunction({
  name: 'works_v1',
  data: {
    action: 'getWork',
    workId: 'w_xxx'
  }
})
```

### 3.5 setPublish
切换作品公开状态。

请求示例：
```js
wx.cloud.callFunction({
  name: 'works_v1',
  data: {
    action: 'setPublish',
    workId: 'w_xxx',
    published: true
  }
})
```

### 3.6 updateStats
更新作品计数字段（likes/saves/comments）。

请求示例：
```js
wx.cloud.callFunction({
  name: 'works_v1',
  data: {
    action: 'updateStats',
    workId: 'w_xxx',
    likes: 10,
    saves: 5,
    comments: 2
  }
})
```

### 3.7 deleteWork
删除作品。

请求示例：
```js
wx.cloud.callFunction({
  name: 'works_v1',
  data: {
    action: 'deleteWork',
    workId: 'w_xxx',
    hardDelete: false,
    purgeFiles: false
  }
})
```

## 4. 返回字段（核心）
- `ok`: 布尔，接口成功与否
- `code/message`: 失败时错误码与错误信息
- `work/list`: 作品对象或列表
- `work` 兼容字段：
  - `id/workId`
  - `image`（封面图）
  - `avatar/nickname`
  - `likes/saves/comments`
  - `published/status`
  - `createdAt/updatedAt`

## 5. 推荐数据结构（works 集合）
- `userKey`
- `owner: { userKey, nickname, avatarUrl }`
- `title`
- `images: { personFileId, clothesFileId, resultFileId, personUrl, clothesUrl, resultUrl }`
- `coverUrl`
- `likes/saves/comments`
- `stats: { likes, saves, comments }`
- `published`
- `status`
- `createdAt/updatedAt/publishedAt/deletedAt`
- `meta`

## 6. 推荐索引（数据库控制台）
为避免查询报索引错误，建议建立：
1. `userKey` + `status` + `createdAt(desc)`
2. `published` + `status` + `createdAt(desc)`

## 7. 存储路径建议
你已经创建了 `works/` 目录，建议前端按以下规则上传：
- `works/{userKey}/{workId}/person.jpg`
- `works/{userKey}/{workId}/clothes.jpg`
- `works/{userKey}/{workId}/result.jpg`

然后把这三个 `fileId` 传给 `createWork`。
