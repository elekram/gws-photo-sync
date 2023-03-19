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

console.log(users)

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
