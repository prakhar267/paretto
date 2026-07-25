import XCTest

final class ParettoUITests: XCTestCase {
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
        app.buttons["Begin in Île-de-France"].tap()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["1 region open"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["1 regions open"].exists)
        app.buttons["Start lesson"].tap()
        XCTAssertTrue(app.buttons["Reveal the card"].waitForExistence(timeout: 5))
    }

    @MainActor
    func testDynamicTypeAccessibilitySizeLaunches() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-reset-state", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Bienvenue"].waitForExistence(timeout: 5))
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
        app.buttons["Begin in Île-de-France"].tap()
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

        XCTAssertTrue(app.buttons["Back to today"].waitForExistence(timeout: 5))
        app.buttons["Back to today"].tap()
        let compactReview = app.tabBars.buttons["Review"]
        if compactReview.exists {
            compactReview.tap()
        } else {
            let regularReview = app.staticTexts["Review"]
            XCTAssertTrue(regularReview.waitForExistence(timeout: 5))
            regularReview.tap()
        }

        let challenge = app.buttons["Begin challenge"]
        XCTAssertTrue(challenge.waitForExistence(timeout: 5))
        XCTAssertTrue(challenge.isEnabled)
        challenge.tap()
        XCTAssertTrue(app.navigationBars["Château Challenge"].waitForExistence(timeout: 5))
        app.buttons["Close"].tap()

        let dice = app.buttons["Open the dice"]
        XCTAssertTrue(dice.waitForExistence(timeout: 5))
        dice.tap()
        XCTAssertTrue(app.navigationBars["Travel dice"].waitForExistence(timeout: 5))
        app.buttons["Roll the dice"].tap()
        XCTAssertTrue(app.buttons["Collect reward"].waitForExistence(timeout: 5))
    }
}
