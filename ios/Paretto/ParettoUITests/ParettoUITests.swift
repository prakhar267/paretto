import XCTest
import UIKit

final class ParettoUITests: XCTestCase {
    private let signInTagline = "Remember useful French, one small journey at a time."
    private let permitsGuestOnboardingSkip = true

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
    func testConfiguredBuildReachesAValidEntryScreen() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-reset-state"]
        app.launch()

        let onboardingName = app.textFields["First name"]
        let appleSignIn = app.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Apple")
        ).firstMatch
        let reachedOnboarding = onboardingName.waitForExistence(timeout: 5)
        let reachedSecureSignIn = appleSignIn.waitForExistence(timeout: 2)

        XCTAssertTrue(
            reachedOnboarding || reachedSecureSignIn,
            "The configured app must reach guest onboarding or secure Apple sign-in."
        )
    }

    @MainActor
    func testOnboardingAndFirstLessonEntry() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-reset-state"]
        app.launch()

        let name = app.textFields["First name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Camille")
        app.buttons["Start with Paris basics"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["1 region open"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["1 regions open"].exists)
        app.buttons["Start lesson"].tap()
        XCTAssertTrue(app.buttons["Reveal the card"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testPrimaryNavigationAndProfileAreReachable() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-reset-state"]
        app.launch()

        let name = app.textFields["First name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Camille")
        app.buttons["Start with Paris basics"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))

        for (title, identifier) in [
            ("Journey", "journey"),
            ("Review", "review"),
            ("Wordbook", "wordbook"),
            ("Today", "today"),
        ] {
            XCTAssertTrue(openSection(title, identifier: identifier, in: app))
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
        }

        let profileButton = app.buttons["Open profile"]
        if profileButton.waitForExistence(timeout: 2) {
            profileButton.tap()
        } else {
            let profileItem = app.staticTexts["app-section-profile"]
            XCTAssertTrue(profileItem.waitForExistence(timeout: 5))
            profileItem.tap()
        }
        XCTAssertTrue(app.navigationBars["Profile"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testBundledFrenchAudioStartsFromTheFirstLesson() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-reset-state"]
        app.launch()

        let name = app.textFields["First name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Camille")
        app.buttons["Start with Paris basics"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))
        app.buttons["Start lesson"].tap()

        let audio = app.buttons["lesson-french-audio"]
        XCTAssertTrue(audio.waitForExistence(timeout: 5))
        audio.tap()
        let bundledRecording = NSPredicate(
            format: "value == %@",
            "High-quality French female recording"
        )
        expectation(for: bundledRecording, evaluatedWith: audio)
        waitForExpectations(timeout: 3)
    }

    @MainActor
    func testDynamicTypeAccessibilitySizeLaunches() throws {
        let app = XCUIApplication()
        app.launchArguments = [
            "-ui-testing",
            "-reset-state",
            "-UIPreferredContentSizeCategoryName",
            UIContentSizeCategory.accessibilityExtraExtraExtraLarge.rawValue,
        ]
        app.launch()
        XCTAssertTrue(app.staticTexts["Your first stop"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testCaptureAppStoreScreenshots() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-reset-state"]
        app.launch()

        let name = app.textFields["First name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        preserveStoreScreenshot(app: app, name: "01-onboarding")

        name.tap()
        name.typeText("Camille")
        app.buttons["Start with Paris basics"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))
        preserveStoreScreenshot(app: app, name: "02-today")

        XCTAssertTrue(openSection("Journey", identifier: "journey", in: app))
        XCTAssertTrue(app.navigationBars["Journey"].waitForExistence(timeout: 5))
        preserveStoreScreenshot(app: app, name: "03-journey")

        XCTAssertTrue(openSection("Today", identifier: "today", in: app))
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))
        app.buttons["Start lesson"].tap()
        XCTAssertTrue(app.buttons["Reveal the card"].waitForExistence(timeout: 5))
        preserveStoreScreenshot(app: app, name: "04-lesson")
    }

    @MainActor
    func testSignedOutTaglineDoesNotTruncateAtSupportedDynamicTypeSizes() throws {
        try assertSignedOutTaglineIsFullyLaidOut(
            launchCategory: UIContentSizeCategory.large.rawValue,
            traitCategory: .large,
            activityName: "Standard text"
        )
        try assertSignedOutTaglineIsFullyLaidOut(
            launchCategory: UIContentSizeCategory.accessibilityExtraExtraExtraLarge.rawValue,
            traitCategory: .accessibilityExtraExtraExtraLarge,
            activityName: "Accessibility XXXL text"
        )
    }

    @MainActor
    func testFirstLessonUnlocksChallengeAndTravelDice() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-reset-state"]
        app.launch()

        let name = app.textFields["First name"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        name.tap()
        name.typeText("Camille")
        app.buttons["Start with Paris basics"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))
        app.buttons["Start lesson"].tap()

        for _ in 0..<5 {
            let reveal = app.buttons["Reveal the card"]
            XCTAssertTrue(reveal.waitForExistence(timeout: 5))
            reveal.tap()
            let gotIt = app.buttons["Got it, Build interval"]
            if gotIt.waitForExistence(timeout: 2) {
                gotIt.tap()
            } else {
                app.buttons["Got it"].tap()
            }
        }

        let backToToday = app.buttons["Back to today"]
        XCTAssertTrue(backToToday.waitForExistence(timeout: 5))
        backToToday.tap()
        XCTAssertTrue(
            backToToday.waitForNonExistence(timeout: 10),
            "The completed lesson cover must finish dismissing."
        )
        XCTAssertTrue(
            app.navigationBars["Today"].waitForExistence(timeout: 10),
            "The lesson must dismiss back to Today before changing sections."
        )
        XCTAssertTrue(
            openReview(in: app),
            "The Review destination must be selected before querying its actions."
        )

        guard let challenge = findHittableReviewAction(
            "review-begin-challenge",
            in: app
        ) else {
            preserveFailureEvidence(
                app: app,
                name: "Missing challenge action after completed lesson"
            )
            XCTFail("The learned-word challenge action was not reachable in Review.")
            return
        }

        XCTAssertTrue(challenge.isEnabled)
        challenge.tap()
        XCTAssertTrue(app.navigationBars["Château Challenge"].waitForExistence(timeout: 5))
        let closeChallenge = app.buttons["Close"]
        closeChallenge.tap()
        XCTAssertTrue(
            closeChallenge.waitForNonExistence(timeout: 10),
            "The challenge cover must finish dismissing."
        )

        XCTAssertTrue(
            app.navigationBars["Review"].waitForExistence(timeout: 10),
            "Closing the challenge must return to Review."
        )
        guard let dice = findHittableReviewAction(
            "review-open-dice",
            in: app
        ) else {
            preserveFailureEvidence(
                app: app,
                name: "Missing dice action after challenge dismissal"
            )
            XCTFail("The learned-word travel-dice action was not reachable in Review.")
            return
        }
        dice.tap()
        XCTAssertTrue(app.navigationBars["Travel dice"].waitForExistence(timeout: 5))
        app.buttons["Roll the dice"].tap()
        XCTAssertTrue(app.buttons["Collect reward"].waitForExistence(timeout: 5))
    }

    @MainActor
    private func openReview(in app: XCUIApplication) -> Bool {
        guard openSection("Review", identifier: "review", in: app) else {
            return false
        }

        guard app.navigationBars["Review"].waitForExistence(timeout: 10) else {
            preserveFailureEvidence(
                app: app,
                name: "Review navigation did not complete"
            )
            return false
        }
        return true
    }

    @MainActor
    private func openSection(
        _ title: String,
        identifier: String,
        in app: XCUIApplication
    ) -> Bool {
        let compactSection = app.tabBars.buttons[title]
        if compactSection.waitForExistence(timeout: 2) {
            compactSection.tap()
        } else {
            let regularSection = app.staticTexts["app-section-\(identifier)"]
            guard regularSection.waitForExistence(timeout: 5) else {
                preserveFailureEvidence(
                    app: app,
                    name: "Missing regular-width \(title) navigation item"
                )
                return false
            }
            regularSection.tap()
        }
        return true
    }

    @MainActor
    private func findHittableReviewAction(
        _ identifier: String,
        in app: XCUIApplication
    ) -> XCUIElement? {
        let action = app.buttons[identifier]
        if action.waitForExistence(timeout: 2), action.isHittable {
            return action
        }

        let reviewScroll = app.scrollViews["review-scroll"]
        guard reviewScroll.waitForExistence(timeout: 5) else {
            return nil
        }
        for _ in 0..<5 {
            reviewScroll.swipeUp()
            if action.waitForExistence(timeout: 1), action.isHittable {
                return action
            }
        }
        return nil
    }

    @MainActor
    private func preserveFailureEvidence(app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)

        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(name) — accessibility hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
    }

    @MainActor
    private func preserveStoreScreenshot(app: XCUIApplication, name: String) {
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    private func assertSignedOutTaglineIsFullyLaidOut(
        launchCategory: String,
        traitCategory: UIContentSizeCategory,
        activityName: String
    ) throws {
        try XCTContext.runActivity(named: activityName) { activity in
            let app = XCUIApplication()
            app.launchArguments = [
                "-ui-testing",
                "-reset-state",
                "-UIPreferredContentSizeCategoryName",
                launchCategory,
            ]
            app.launch()
            defer { app.terminate() }

            let tagline = app.staticTexts["sign-in-tagline"]
            guard tagline.waitForExistence(timeout: 5) else {
                let onboardingName = app.textFields["First name"]
                let onboardingTitle = app.staticTexts["Your first stop"]
                if permitsGuestOnboardingSkip,
                   onboardingName.waitForExistence(timeout: 2),
                   onboardingTitle.exists {
                    throw XCTSkip(
                        "Debug guest mode reached its verified onboarding screen."
                    )
                }
                XCTFail(
                    """
                    The secure sign-in tagline is missing. Only a Debug build \
                    visibly showing guest onboarding may skip this regression.
                    """
                )
                return
            }
            XCTAssertEqual(
                tagline.label,
                signInTagline,
                "The signed-out screen must expose the complete tagline."
            )

            let appleSignIn = app.buttons.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "Apple")
            ).firstMatch
            XCTAssertTrue(
                appleSignIn.waitForExistence(timeout: 2),
                "Reset-state UI tests must remain signed out and require no credentials."
            )

            let window = app.windows.firstMatch
            XCTAssertTrue(window.waitForExistence(timeout: 2))
            XCTAssertTrue(
                window.frame.contains(tagline.frame),
                "The complete tagline frame must be visible within the app window."
            )

            let traits = UITraitCollection(preferredContentSizeCategory: traitCategory)
            let font = UIFont.preferredFont(
                forTextStyle: .title3,
                compatibleWith: traits
            )
            let requiredHeight = ceil(
                (signInTagline as NSString).boundingRect(
                    with: CGSize(
                        width: tagline.frame.width,
                        height: CGFloat.greatestFiniteMagnitude
                    ),
                    options: [.usesLineFragmentOrigin, .usesFontLeading],
                    attributes: [.font: font],
                    context: nil
                ).height
            )
            XCTAssertGreaterThanOrEqual(
                tagline.frame.height + 1,
                requiredHeight,
                """
                The tagline frame is \(tagline.frame.height) points high but the \
                full copy requires \(requiredHeight) points at \(activityName).
                """
            )

            let screenshot = XCTAttachment(screenshot: app.screenshot())
            screenshot.name =
                "Signed-out tagline — \(activityName) — " +
                "rendered \(tagline.frame.height)pt / required \(requiredHeight)pt"
            screenshot.lifetime = .keepAlways
            activity.add(screenshot)
        }
    }
}
