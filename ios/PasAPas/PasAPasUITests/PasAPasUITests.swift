import XCTest

final class PasAPasUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

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
        app.buttons["Start lesson"].tap()
        XCTAssertTrue(app.buttons["Reveal the card"].waitForExistence(timeout: 5))
    }

    func testDynamicTypeAccessibilitySizeLaunches() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-ui-testing", "-reset-state", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityExtraExtraExtraLarge"]
        app.launch()
        XCTAssertTrue(app.staticTexts["Bienvenue"].waitForExistence(timeout: 5))
    }

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
        app.tabBars.buttons["Review"].tap()

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
