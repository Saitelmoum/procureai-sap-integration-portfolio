import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonOutput

def Message processData(Message message) {

    def output = [
        orderId: message.getProperty("orderId"),

        supplier: [
            name: message.getProperty("supplierName"),
            country: message.getProperty("supplierCountry"),
            vatNumber: message.getProperty("vatNumber"),
            vatValidationStatus:
                message.getProperty("vatValidationStatus")
        ],

        amount: message.getProperty("amountEUR"),
        currency: message.getProperty("currency"),

        decision: message.getProperty("decision"),
        reason: message.getProperty("reason"),

        technical: [
            category:
                message.getProperty("errorCategory")
        ]
    ]

    message.setBody(
        JsonOutput.toJson(output)
    )

    message.setHeader(
        "Content-Type",
        "application/json"
    )

    return message
}