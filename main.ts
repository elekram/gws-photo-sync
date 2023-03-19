import appSettings from './config/config.ts'
import { base64url } from './src/deps.ts'
import { TinyLogger } from './src/deps.ts'
import { getToken, GoogleAuth } from './src/deps.ts'
import { crypto, toHashString } from './src/deps.ts'

const googleServiceAccountCredentials = await Deno.readTextFile(
  appSettings.serviceAccountCredentials,
)

const googleAuthOptions = {
  scope: appSettings.scopes,
  delegationSubject: appSettings.subject,
}

const auth: GoogleAuth = await getToken(
  googleServiceAccountCredentials,
  googleAuthOptions,
)

const users = await getUsers(
  auth,
  appSettings.domain,
  500,
)

interface Task {
  primaryEmail: string
  workspaceId: string
  photoData: string
  etag: string
}

const tasks: Task[] = []

for await (const f of Deno.readDir(appSettings.imagePath)) {
  if (f.isFile) {
    const userName = `${
      f.name.split('.')[0].toLowerCase()
    }@${appSettings.domain}`

    if (!users.has(userName) || users.get(userName).suspended) {
      continue
    }

    const workspaceId = users.get(userName).id
    const primaryEmail = users.get(userName).email

    const file = await Deno.readFile(`${appSettings.imagePath}/${f.name}`)
    const photoData = base64url.encode(file)

    const md5 = await crypto.subtle.digest(
      'MD5',
      new TextEncoder().encode(photoData),
    )

    const etag = toHashString(md5)

    const task: Task = {
      primaryEmail,
      workspaceId,
      photoData,
      etag,
    }
    tasks.push(task)
  }
}

runTasks(tasks)

async function runTasks(tasks: Task[]) {
  await Promise.all(
    tasks.map(async (task, index) => {
      await updatePhoto(
        auth,
        task.primaryEmail,
        task.workspaceId,
        task.photoData,
        task.etag,
        index,
        tasks.length,
      )
    }),
  )
}

async function updatePhoto(
  auth: GoogleAuth,
  userId: string,
  workspaceId: string,
  photoData: string,
  etag: string,
  index: number,
  total: number,
) {
  index = index + 1
  const encodedUserId = encodeURIComponent(userId)
  const url =
    `https://admin.googleapis.com/admin/directory/v1/users/${encodedUserId}/photos/thumbnail`

  const delay = index * appSettings.taskDelay
  await sleep(delay)

  console.log(`Setting user photo for ${userId} - ${index} of ${total} tasks`)

  const body = JSON.stringify({
    id: workspaceId,
    primaryEmail: userId,
    kind: 'admin#directory#user#photo',
    etag: etag,
    photoData: photoData,
    mimeType: 'JPEG',
    width: 250,
    height: 250,
  })

  try {
    const response = await fetch(
      url,
      {
        method: 'PUT',
        headers: getHeaders(auth),
        body,
      },
    )

    if (response.status === 200) {
      console.log(
        `%c[ Set user photo for ${userId} - Status: ${response.status} ok ]\n`,
        'color:green',
      )
    } else {
      throw `Status: ${response.status} exiting script`
    }
  } catch (e) {
    console.log(e)
    Deno.exit(1)
  }
}

async function getUsers(
  auth: GoogleAuth,
  domain: string,
  maxResults: number,
) {
  const path = 'https://admin.googleapis.com/admin/directory/v1/users'
  const users = new Map()

  let nextPageToken = ''

  console.log(
    `\n%c[ Fetching users for ${appSettings.domain} ]\n`,
    'color:green',
  )

  do {
    const pageToken = `pageToken=${nextPageToken}`

    const response = await fetch(
      `${path}?domain=${domain}&maxResults=${maxResults}&${pageToken}`,
      {
        method: 'GET',
        headers: getHeaders(auth),
      },
    )

    const data = await response.json()

    if (!data.users) {
      throw `error: not users returned in response JSON`
    }

    if (data.users.length) {
      data.users.forEach((user: any) => {
        const userName = user.primaryEmail.toLowerCase()
        users.set(userName, {
          id: user.id,
          email: user.primaryEmail,
          name: user.name,
          suspended: user.suspended,
          isAdmin: user.isAdmin,
        })
      })
    }

    console.log(`%c[ ...${users.size} users ]`, 'color:lightblue')

    nextPageToken = data.nextPageToken
  } while (nextPageToken)

  console.log(`\n%c[ ${users.size} total users fetched ]\n`, 'color:cyan')
  return users
}

function getHeaders(auth: GoogleAuth) {
  return {
    'authorization': `Bearer ${auth.access_token}`,
    'content-type': 'application/json',
    'accept': 'application/json',
  }
}

function sleep(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay))
}
