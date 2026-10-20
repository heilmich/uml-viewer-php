<?php

declare(strict_types=1);

namespace Shop\Http\Controller;

use Shop\Application\PlaceOrder;
use Shop\Application\PlaceOrderHandler;
use Shop\Domain\Model\Currency;
use Shop\Domain\Model\Customer;
use Shop\Domain\Model\Money;
use Shop\Domain\Model\OrderLine;
use Shop\Domain\Model\Product;
use Shop\Http\Attribute\Route;

final class OrderController
{
    public function __construct(private readonly PlaceOrderHandler $placeOrder)
    {
    }

    /** @param array{email: string, sku: string, title: string, cents: int, quantity: int} $body */
    #[Route('/orders', method: 'POST')]
    public function create(array $body): array
    {
        $product = new Product($body['sku'], $body['title'], Money::of($body['cents'], Currency::EUR));
        $id = ($this->placeOrder)(new PlaceOrder(
            new Customer($body['email']),
            [new OrderLine($product, $body['quantity'])],
        ));
        return ['id' => $id->value];
    }
}
