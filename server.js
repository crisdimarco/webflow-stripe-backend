// Bottone "Paga ora" che invia l'ordine a Stripe con i dati aggiuntivi
payButton.addEventListener("click", async function () {
    if (cart.length === 0) {
        alert("Il carrello è vuoto!");
        return;
    }
    if (!selectTime.value) {
        alert("Seleziona un orario di ritiro!");
        return;
    }

    try {
        const response = await fetch(`${backendUrl}/create-checkout-session`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                items: cart,
                orderNumber: generateOrderNumber(),
                pickupDate: getPickupDate(),
                pickupTime: selectTime.options[selectTime.selectedIndex].text
            })
        });

        const data = await response.json();
        console.log("Risposta dal backend:", data);

        if (data.url) {
            window.location.href = data.url; // Reindirizza a Stripe Checkout
        } else {
            alert("Errore nel pagamento, riprova.");
        }
    } catch (error) {
        console.error("Errore nella richiesta di pagamento:", error);
        alert("Errore nel pagamento.");
    }
});
