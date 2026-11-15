Some items are tax free. An item can now have `taxFree: true`. The tax
of an invoice is 8% of the items that are not tax free, and the total
is the subtotal of all items plus that tax. Make the invoice handle it,
and add tests.
