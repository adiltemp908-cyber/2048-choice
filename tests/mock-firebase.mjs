// Browser regression fixtures must never upload synthetic scores to the real project.
export async function mockFirebase(page) {
  await page.route(/^https:\/\/(identitytoolkit|securetoken|firestore)\.googleapis\.com\//, route => {
    const url = route.request().url();
    let body = {}, status = 200;
    if (url.includes('accounts:signUp')) body = { idToken: 'test-token', refreshToken: 'test-refresh', localId: 'test-player', expiresIn: '3600' };
    else if (url.includes('securetoken')) body = { id_token: 'test-token', refresh_token: 'test-refresh', user_id: 'test-player', expires_in: '3600' };
    else if (url.includes(':runQuery')) body = [];
    else if (route.request().method() === 'GET') { body = { error: { message: 'Not found' } }; status = 404; }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
