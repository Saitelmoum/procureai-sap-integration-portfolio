import com.sap.gateway.ip.core.customdev.util.Message

def Message processData(Message message) {

    def exception = message.getProperty("CamelExceptionCaught")

    def errorMessage =
        exception?.getMessage() ?: "Unknown integration error"

    message.setProperty(
        "technicalErrorMessage",
        errorMessage
    )

    // VIES unavailable / blocked
    if (
        errorMessage.contains("IP_BLOCKED") ||
        errorMessage.contains("MS_UNAVAILABLE") ||
        errorMessage.contains("TIMEOUT") ||
        errorMessage.toLowerCase().contains("timed out")
    ) {

        message.setProperty(
            "vatValidationStatus",
            "UNAVAILABLE"
        )

        message.setProperty(
            "decision",
            "MANUAL_REVIEW"
        )

        message.setProperty(
            "reason",
            "VAT validation service is currently unavailable"
        )

        message.setProperty(
            "errorCategory",
            "EXTERNAL_SERVICE_UNAVAILABLE"
        )
    }
    else {

        message.setProperty(
            "vatValidationStatus",
            "NOT_COMPLETED"
        )

        message.setProperty(
            "decision",
            "TECHNICAL_ERROR"
        )

        message.setProperty(
            "reason",
            "Purchase order processing failed"
        )

        message.setProperty(
            "errorCategory",
            "INTEGRATION_ERROR"
        )
    }

    return message
}