import AuthenticationServices
import SwiftUI

struct SecureAppleSignInButton: View {
    @EnvironmentObject private var model: AppModel
    @State private var rawNonce: String?

    var body: some View {
        SignInWithAppleButton(.continue) { request in
            do {
                let nonce = try AppleSignInNonce.make()
                rawNonce = nonce
                request.nonce = AppleSignInNonce.hash(nonce)
                request.requestedScopes = [.fullName, .email]
            } catch {
                rawNonce = nil
                model.alertMessage = error.localizedDescription
            }
        } onCompletion: { result in
            let nonce = rawNonce
            rawNonce = nil
            guard let nonce else {
                model.alertMessage = AppleSignInNonceError.randomnessUnavailable.localizedDescription
                return
            }
            guard case .success(let authorization) = result,
                  let credential = authorization.credential as? ASAuthorizationAppleIDCredential
            else {
                if case .failure(let error) = result {
                    model.alertMessage = error.localizedDescription
                }
                return
            }
            Task { await model.authenticate(credential: credential, rawNonce: nonce) }
        }
        .signInWithAppleButtonStyle(.black)
        .accessibilityHint("Creates or opens your secure Pas à Pas account")
    }
}
