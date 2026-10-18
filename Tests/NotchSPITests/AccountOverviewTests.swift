import XCTest
@testable import NotchSPI

final class AccountOverviewTests: XCTestCase {
    func testProtectionAndConsumptionOrder() {
        let sources = ["trial":0,"plus":0,"purchased":10,"other":0]
        let protected = AccountOverview(sources:sources,trial:nil,registered:true,rejected:false,allowPurchased:false,externalService:false)
        XCTAssertFalse(protected.canSolve)
        XCTAssertTrue(AccountOverview(sources:sources,trial:nil,registered:true,rejected:false,allowPurchased:true,externalService:false).canSolve)
        XCTAssertTrue(AccountOverview(sources:sources.merging(["plus":1]) {_,v in v},trial:nil,registered:true,rejected:false,allowPurchased:false,externalService:false).canSolve)
        XCTAssertFalse(AccountOverview(sources:sources,trial:nil,registered:true,rejected:true,allowPurchased:true,externalService:false).canSolve)
        XCTAssertTrue(AccountOverview(sources:nil,trial:nil,registered:false,rejected:false,allowPurchased:false,externalService:true).canSolve)
    }
    func testCaptureRequestCarriesProtection() throws {
        let prompt = Prompts.capturePrompt(mode:"tutor",depth:"brief",personaName:"",personaText:"",sessionContext:"")
        let request = OfficialAPI.makeCaptureRequest(baseURL:"https://example.test",deviceToken:"test",prompt:prompt,imagesBase64:["test"],allowPurchasedCredits:false)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String:Any])
        XCTAssertEqual(json["allow_purchased_credits"] as? Bool,false)
    }
    func testInvalidSourceTotalsAreRejected() throws {
        let data = Data(#"{"balance_questions":10,"allowance_sources":{"trial":0,"plus":400,"purchased":10,"other":0}}"#.utf8)
        let response = try JSONDecoder().decode(OfficialAccountResponse.self,from:data)
        XCTAssertThrowsError(try response.validate(registration:false))
    }
}
