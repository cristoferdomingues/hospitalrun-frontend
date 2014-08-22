export default Ember.Mixin.create({
    actions: {
        fulfillRequest: function(request, closeModal, increment, skipTransition) {
            var markAsConsumed = request.get('markAsConsumed');
            
            if (markAsConsumed) {
                if (Ember.isEmpty(request.get('transactionType'))) {
                    request.set('transactionType', 'Fulfillment');
                }
                this.performFulfillment(request, increment).then(function() {
                    this.finishFulfillRequest(request, closeModal, increment, skipTransition);
                }.bind(this));
            } else {
                if (Ember.isEmpty(request.get('transactionType'))) {
                    request.set('transactionType', 'Transfer');
                }
                this.finishFulfillRequest(request, closeModal, increment, skipTransition);
            }
        }
    },
    
    finishFulfillRequest: function(request, closeModal, increment, skipTransition) {
        var inventoryItem = request.get('inventoryItem'),            
            markAsConsumed = request.get('markAsConsumed'),
            promises = [],
            quantity = parseInt(request.get('quantity')),
            requestPurchases = request.get('purchases');
        request.get('inventoryLocations').then(function(inventoryLocations) {
            if (increment) {
                inventoryLocations.get('firstObject').incrementProperty('quantity', quantity);
            } else {
                inventoryLocations.reduce(function(quantityNeeded, location) {
                    var deliveryLocation = request.get('deliveryLocation'),
                        deliveryAisle = request.get('deliveryAisle'),
                        locationQuantity = parseInt(location.get('quantity'));                
                    if (quantityNeeded > 0) {
                        if (!markAsConsumed) {
                            location.set('transferAisleLocation', deliveryAisle);
                            location.set('transferLocation', deliveryLocation);                        
                        }
                        if (locationQuantity >= quantityNeeded) {                        
                            if (markAsConsumed) {
                                location.decrementProperty('quantity', quantityNeeded);
                                promises.push(location.save());
                            } else {
                                location.set('adjustmentQuantity', quantityNeeded);
                                this.transferToLocation(inventoryItem, location);                            
                            }
                            return 0;
                        } else {                                
                            if (markAsConsumed) {                            
                                location.decrementProperty('quantity', locationQuantity);
                                promises.push(location.save());
                            } else {
                                location.set('adjustmentQuantity', locationQuantity);
                                this.transferToLocation(inventoryItem, location);                            
                            }
                            return (quantityNeeded - locationQuantity);
                        }
                        if (markAsConsumed) {
                            promises.push(location.save());
                        }
                    }                
                }.bind(this), quantity);
            }        
            if (markAsConsumed) {        
                requestPurchases.forEach(function(purchase) {
                    promises.push(purchase.save());
                });
            }
            promises.push(inventoryItem.get('content').save());
            request.set('status','Completed');
            request.set('completedBy', request.getUserName());
            promises.push(request.save());
            Ember.RSVP.all(promises,'All saving done for inventory fulfillment').then(function(){
                if (closeModal) {
                    this.send('closeModal');
                }
                if (!skipTransition) {
                    this.transitionTo('inventory.completed');
                }
            }.bind(this));
        }.bind(this));
    },
    
    /**
     * Fulfill the request, decrementing from the purchases available on the inventory item
     * This function doesn't save anything, it just updates the objects in memory, so 
     * a route will need to ensure that the models affected here get updated.
     * @param {boolean} increment if the request should increment, not decrement
     * @returns true if the request is fulfilled; false if it cannot be fulfilled due to a lack
     * of stock.
     */
    performFulfillment: function(request, increment) {
        return new Ember.RSVP.Promise(function(resolve, reject){
            var item = request.get('inventoryItem'),
                purchases = item.get('purchases'),
                quantityOnHand = item.get('quantity'),
                quantityRequested = request.get('quantity');
            if (increment || (quantityOnHand >= quantityRequested)) {
                request.get('purchases').then(function(requestPurchases){
                    var findResult = this.findQuantity(request, purchases, item, requestPurchases, increment);
                    if (findResult === true) {
                        resolve();
                    } else {
                        reject(findResult);
                    }
                }.bind(this));
            } else {
                reject('The quantity on hand, %@ is less than the requested quantity of %@.'.fmt(quantityOnHand,quantityRequested));
            }
        }.bind(this));
    },    

});