import com.sap.gateway.ip.core.customdev.util.Message
import groovy.json.JsonSlurper

def Message processData(Message message) {

    def reader = message.getBody(java.io.Reader)
    def input = new JsonSlurper().parse(reader)

    // ---------- Mandatory fields ----------

    if (!input.orderId) {
        throw new IllegalArgumentException("orderId is required")
    }

    if (!input.supplier?.name) {
        throw new IllegalArgumentException("supplier.name is required")
    }

    if (!input.supplier?.country) {
        throw new IllegalArgumentException("supplier.country is required")
    }

    if (input.amount == null) {
        throw new IllegalArgumentException("amount is required")
    }

    if (!input.currency) {
        throw new IllegalArgumentException("currency is required")
    }

    // ---------- Normalization ----------

    def amount = new BigDecimal(input.amount.toString())

    def currency =
        input.currency.toString().trim().toUpperCase()

    def country =
        input.supplier.country.toString().trim().toUpperCase()

    def vatRaw =
        input.supplier.vatNumber
            .toString()
            .replaceAll("\\s+", "")
            .toUpperCase()

    if (amount < 0) {
        throw new IllegalArgumentException("amount cannot be negative")
    }

    if (!(country ==~ /[A-Z]{2}/)) {
        throw new IllegalArgumentException("supplier.country must contain 2 letters")
    }

    // VIES expects country separately.
    // DE143454214 -> 143454214
    def vatNormalized =
        vatRaw.startsWith(country)
        ? vatRaw.substring(country.length())
        : vatRaw

    // ---------- Exchange Properties ----------

    message.setProperty("orderId", input.orderId.toString())

    message.setProperty(
        "supplierName",
        input.supplier.name.toString()
    )

    message.setProperty(
        "supplierCountry",
        country
    )

message.setProperty(
    "vatNumber",
    input.supplier?.vatNumber?.toString()
)

    message.setProperty(
        "vatNumberNormalized",
        vatNormalized
    )

    message.setProperty("originalAmount", amount)
    message.setProperty("currency", currency)

    if (currency == "EUR") {
    message.setProperty("amountEUR", amount)
}
   // message.setProperty("currency", currency)

    return message
}